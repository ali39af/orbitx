import type { AIProvider, Message, StreamCallback, ToolSchema, ToolCallRequest, ChatResponse, MessageUsage } from "./ai-provider.js";
import type MCPClient from "./mcp-client.js";
import type MCPTool from "./mcp.js";
import { resolveAgentProviders, type AgentProvidersInput } from "./agent-providers.js";

export interface StatelessAgentProps {
    instruction: string;
    safetyPolicies?: string;
    aiProvider: AgentProvidersInput;
    mcpClient?: MCPClient;
    allowedTools?: MCPTool[];
}

export interface DispatchedToolCall {
    id: string;
    name: string;
    inputs: Record<string, any>;
    resultText: string;
}

export interface StatelessAgentResult {
    content: string;
    toolCalls: DispatchedToolCall[];
    usage: MessageUsage[];
    messages: Message[];
}

export class StatelessAgent {
    #instruction: string;
    #safetyPolicies: string;
    #provider: AIProvider;
    #mcpClient?: MCPClient;
    #allowedTools: MCPTool[];

    constructor({ instruction, safetyPolicies = "", aiProvider, mcpClient, allowedTools = [] }: StatelessAgentProps) {
        if (allowedTools.length > 0 && !mcpClient) {
            throw new Error("StatelessAgent: mcpClient is required when allowedTools is non-empty.");
        }

        this.#instruction = instruction;
        this.#safetyPolicies = safetyPolicies;
        this.#provider = resolveAgentProviders(aiProvider).getMain();
        this.#mcpClient = mcpClient;
        this.#allowedTools = allowedTools;
    }

    async #getToolSchemas(): Promise<ToolSchema[]> {
        if (this.#allowedTools.length === 0 || !this.#mcpClient) return [];
        const allowedNames = new Set(this.#allowedTools.map(t => t.getOptions().name));
        const tools = await this.#mcpClient.getTools();
        return tools.filter(t => allowedNames.has(t.name));
    }

    async #dispatchTool(call: ToolCallRequest): Promise<DispatchedToolCall> {
        if (!this.#allowedTools.map(t => t.getOptions().name).includes(call.name)) {
            return { ...call, resultText: `Error: tool "${call.name}" not found or not allowed.` };
        }
        try {
            const output = await this.#mcpClient!.callTool(call.name, call.inputs, call.id);
            return { ...call, resultText: JSON.stringify(output.output) };
        } catch (err: any) {
            return { ...call, resultText: `Error: ${err?.message ?? String(err)}` };
        }
    }

    #usageEntry(chat: ChatResponse): MessageUsage {
        return {
            type: "main",
            model: this.#provider.getModel(),
            unit: "tokens",
            inputMissTokens: chat.inputMissTokens ?? 0,
            inputCacheTokens: chat.inputCacheTokens ?? 0,
            outputTokens: chat.outputTokens ?? 0,
        };
    }

    async run(input: string, streamCallback?: StreamCallback, previousMessages?: Message[]): Promise<StatelessAgentResult> {
        const tools = await this.#getToolSchemas();
        const toolsArg = tools.length ? tools : undefined;

        const messages: Message[] = previousMessages
            ? [...previousMessages, { role: "user", content: input }]
            : [
                { role: "system", content: this.#safetyPolicies },
                { role: "system", content: this.#instruction },
                { role: "user", content: input },
            ];

        const chat = await this.#provider.chat(messages, streamCallback, toolsArg);
        const usage: MessageUsage[] = [this.#usageEntry(chat)];

        const requestedCalls = chat.toolCalls ?? [];
        messages.push({
            role: "assistant",
            content: chat.content,
            ...(requestedCalls.length ? { toolCalls: requestedCalls } : {}),
        });

        if (requestedCalls.length === 0) {
            return { content: chat.content, toolCalls: [], usage, messages };
        }

        const dispatched: DispatchedToolCall[] = [];
        for (const call of requestedCalls) {
            dispatched.push(await this.#dispatchTool(call));
        }
        for (const result of dispatched) {
            messages.push({ role: "tool", content: result.resultText, toolCallId: result.id, toolName: result.name });
        }

        return { content: chat.content, toolCalls: dispatched, usage, messages };
    }
}

export default StatelessAgent;
