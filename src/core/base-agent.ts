import type { AIProvider, Message, StreamCallback } from "./ai-provider.js";
import type MCPClient from "./mcp-client.js";
import type MCPTool from "./mcp.js";
import type Skill from "./skill.js";

export interface ParsedToolCall {
    id: string;
    tool: string;
    inputs: Record<string, any>;
}

export type ExtractedSegment =
    | { type: "text"; context: string }
    | { type: "tool"; context: ParsedToolCall };

export class BaseAgent {
    #maxMemorizeToken = 16000;
    #instruction: string = "";
    #allowedTools: string[] = [];

    #skills: Skill[] = [];

    #memory: string = "";

    #messagesFull: Message[] = [];

    #fullInputMissTokens = 0;
    #fullInputHitTokens = 0;
    #fullOutputTokens = 0;

    #messagesCompact: Message[] = [];
    #currentInputMissTokens = 0;
    #currentInputHitTokens = 0;
    #currentLastOutputTokens = 0;
    #currentOutputTokens = 0;

    #mcpClient: MCPClient;
    #aiProvider: AIProvider;

    constructor({ instruction, allowedTools, aiProvider, mcpClient, initData = {
        memory: "",
        messagesFull: [],
        fullInputMissTokens: 0,
        fullInputHitTokens: 0,
        fullOutputTokens: 0,
        messagesCompact: [],
        currentInputMissTokens: 0,
        currentInputHitTokens: 0,
        currentOutputTokens: 0,
    }, skills = [], maxMemorizeToken = 16000 }: {
        instruction: string;
        allowedTools: MCPTool[];
        aiProvider: AIProvider;
        mcpClient: MCPClient;
        skills?: Skill[];
        maxMemorizeToken?: number;
        initData?: {
            memory: string;
            messagesFull: Message[];
            fullInputMissTokens: number;
            fullInputHitTokens: number;
            fullOutputTokens: number;
            messagesCompact: Message[];
            currentInputMissTokens: number;
            currentInputHitTokens: number;
            currentOutputTokens: number;
        }
    }) {
        this.#instruction = instruction;
        this.#allowedTools = allowedTools.map(t => t.getOptions().name);
        this.#aiProvider = aiProvider;
        this.#mcpClient = mcpClient;
        this.#memory = initData.memory;
        this.#messagesFull = initData.messagesFull;
        this.#fullInputMissTokens = initData.fullInputMissTokens
        this.#fullInputHitTokens = initData.fullInputHitTokens
        this.#fullOutputTokens = initData.fullOutputTokens
        this.#messagesCompact = initData.messagesCompact;
        this.#currentInputMissTokens = initData.currentInputMissTokens
        this.#currentInputHitTokens = initData.currentInputHitTokens
        this.#currentOutputTokens = initData.currentOutputTokens
        this.#maxMemorizeToken = maxMemorizeToken;
        this.#skills = skills;
    }

    #extractJson(str: string): ExtractedSegment[] {
        const segments: ExtractedSegment[] = [];
        let cursor = 0;
        let textStart = 0;

        for (let i = 0; i < str.length; i++) {
            if (str[i] !== "{") continue;

            let brace = 0;
            for (let j = i; j < str.length; j++) {
                if (str[j] === "{") brace++;
                if (str[j] === "}") brace--;

                if (brace === 0) {
                    const candidate = str.slice(i, j + 1);
                    try {
                        const result = JSON.parse(candidate);
                        if (
                            result &&
                            typeof result === "object" &&
                            "tool" in result &&
                            "inputs" in result &&
                            typeof result.tool === "string"
                        ) {
                            const text = str.slice(textStart, i);
                            if (text.trim().length > 0) {
                                segments.push({ type: "text", context: text });
                            }
                            segments.push({ type: "tool", context: result as ParsedToolCall });

                            i = j;
                            textStart = j + 1;
                            cursor = j + 1;
                        }
                    } catch {
                        // not valid JSON, skip
                    }
                    break;
                }
            }
        }

        const remaining = str.slice(textStart);
        if (remaining.trim().length > 0) {
            segments.push({ type: "text", context: remaining });
        }

        return segments;
    }

    async #buildSystemPrompt(): Promise<string> {
        const tools = (await this.#mcpClient.getTools())
            .filter(t => this.#allowedTools.includes(t.name));

        const toolBlock = tools.map(t => {
            const params = t.inputs.map((ti: any) =>
                `${ti.name}${ti.required ? "" : "?"}:${ti.type}${ti.default !== undefined ? `=${JSON.stringify(ti.default)}` : ""} // ${ti.description}`
            ).join(", ");

            const example: Record<string, unknown> = {};
            t.inputs.forEach((ti: any) => {
                example[ti.name] = ti.default !== undefined ? ti.default
                    : ti.type === "string" ? "..."
                        : ti.type === "number" ? 0
                            : ti.type === "boolean" ? true
                                : ti.type === "array" ? []
                                    : {};
            });

            return `${t.name}(${params || ""})\n${t.description}\nex: {"tool":"${t.name}","inputs":${JSON.stringify(example)}}`;
        }).join("\n\n");

        return `You are an assistant with tools. CRITICAL RULES:
1. Think step by step.
${tools.length > 0 && `2. EVERY tool call MUST include a UNIQUE 10-digit random ID in the format: {"id":"1234567890", "tool":"<name>","inputs":{...}}
3. The ID MUST be exactly 10 digits (numbers only) and MUST be different for EACH tool call.
4. Example of VALID tool call: {"id":"7845123698", "tool":"search", "inputs":{"query":"weather"}}
5. After each tool result, continue reasoning or call another tool.
6. Never invent tool results.`}
${tools.length > 0 ? "7" : "2"}. If any rules conflict with upper ones, align with upper rules.

${tools.length > 0 && `REMEMBER: Every tool call MUST include a random 10-digit ID!

TOOLS:
${toolBlock}
`}

${this.#skills && `
SKILLS:
${this.#skills.map(skill => (`${skill.getSkill().name} - ${skill.getSkill().description}
${skill.getSkill().instructions}
\n`))}
`}

MEMORY:
${this.#memory || "(empty)"}

INSTRUCTIONS:
${this.#instruction}
`;
    }

    #buildMemoryPrompt(): string {
        return `Summarize all important facts and pending tasks from this conversation.
Output only this JSON line, nothing else:
{"tool":"set_memory","inputs":{"new_memory":"<compact summary>"}}`;
    }

    async #extractToolCalls(content: string): Promise<ParsedToolCall[]> {
        return await this.#extractJson(content)
            .filter((r: { type: string }) => r.type === "tool")
            .map((t) => t.context as ParsedToolCall);
    }

    async #dispatchTool(toolCall: ParsedToolCall): Promise<string> {
        if (toolCall.tool === "set_memory") {
            if (typeof toolCall.inputs?.new_memory === "string") {
                this.#memory = toolCall.inputs.new_memory;
                return "Memory updated.";
            }
            return `Error: set_memory requires new_memory:string, got ${JSON.stringify(toolCall.inputs)}`;
        }

        if (this.#allowedTools.includes(toolCall.tool)) {
            return JSON.stringify({ id: toolCall.id, output: await this.#mcpClient.callTool(toolCall.tool, toolCall.inputs) });
        }

        return `Error: tool "${toolCall.tool}" not found or not allowed.`;
    }

    async run(prompt: string, streamCallback?: StreamCallback): Promise<void> {
        let toolsCalls: ParsedToolCall[] = [];

        do {
            const systemPrompt = await this.#buildSystemPrompt();

            const chat = await this.#aiProvider.chat([
                { role: "system", content: systemPrompt },
                ...this.#messagesCompact,
                { role: "user", content: prompt }
            ], streamCallback);

            this.#messagesFull.push({ role: "user", content: prompt });
            this.#messagesCompact.push({ role: "user", content: prompt });
            this.#messagesFull.push({ role: "assistant", content: chat.content });
            this.#messagesCompact.push({ role: "assistant", content: chat.content });

            this.#currentInputHitTokens += this.#currentInputMissTokens;
            this.#currentInputMissTokens += chat.inputTokens - this.#currentInputMissTokens;
            this.#currentOutputTokens += chat.outputTokens;
            this.#currentLastOutputTokens = chat.outputTokens;

            toolsCalls = await this.#extractToolCalls(chat.content);

            for (const toolCall of toolsCalls) {
                const toolResponse = await this.#dispatchTool(toolCall);
                this.#messagesFull.push({ role: "system", content: toolResponse });
                this.#messagesCompact.push({ role: "system", content: toolResponse });
                streamCallback?.({ role: "tool", content: toolResponse, done: true });
            }

            if (this.#currentInputMissTokens + this.#currentLastOutputTokens > this.#maxMemorizeToken) {
                const memChat = await this.#aiProvider.chat([
                    { role: "system", content: systemPrompt },
                    ...this.#messagesCompact,
                    { role: "user", content: this.#buildMemoryPrompt() }
                ]);

                this.#currentInputHitTokens += this.#currentInputMissTokens;
                this.#currentInputMissTokens += memChat.inputTokens - this.#currentInputMissTokens;
                this.#currentOutputTokens += memChat.outputTokens;

                for (const mc of await this.#extractToolCalls(memChat.content)) {
                    const toolResponse = await this.#dispatchTool(mc);
                    streamCallback?.({ role: "tool", content: toolResponse, done: true });
                }

                this.#messagesCompact = [];
                this.#fullInputHitTokens += this.#currentInputHitTokens;
                this.#fullInputMissTokens += this.#currentInputMissTokens;
                this.#fullOutputTokens += this.#currentOutputTokens;
                this.#currentInputHitTokens = 0;
                this.#currentInputMissTokens = 0;
                this.#currentOutputTokens = 0;
                this.#currentLastOutputTokens = 0;
            }

            prompt = "";

        } while (toolsCalls.length > 0);
    }

    getCurrentTotalTokens() {
        return {
            total: this.#currentInputHitTokens + this.#currentInputMissTokens + this.#currentOutputTokens,
            inputHit: this.#currentInputHitTokens,
            inputMiss: this.#currentInputMissTokens,
            output: this.#currentOutputTokens
        };
    }

    getFullTotalTokens() {
        return {
            total: this.#fullInputHitTokens + this.#fullInputMissTokens + this.#fullOutputTokens,
            inputHit: this.#fullInputHitTokens,
            inputMiss: this.#fullInputMissTokens,
            output: this.#fullOutputTokens
        };
    }
}

export default BaseAgent;