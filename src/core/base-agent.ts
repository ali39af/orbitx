import type { AIProvider, Message, StreamCallback, ToolSchema, ToolCallRequest, ChatResponse, MessageUsage, ProviderType } from "./ai-provider.js";
import type MCPClient from "./mcp-client.js";
import type MCPTool from "./mcp.js";
import type Skill from "./skill.js";
import { resolveAgentProviders, type AgentProvidersInput, type ProviderRegistry } from "./agent-providers.js";

export interface ParsedToolCall {
    id: string;
    tool: string;
    inputs: Record<string, any>;
}

export type ExtractedSegment =
    | { type: "text"; context: string }
    | { type: "tool"; context: ParsedToolCall };

interface DispatchedToolResult {
    id: string;
    name: string;
    /** Text ultimately shown to the model — the tool's own (JSON-stringified) output. Never includes `usage` — that's a side channel onto the resulting Message, not something the model reads. */
    resultText: string;
    /** Real usage recorded by #executeProvider for every `mcp.executeProvider(...)` call this tool made, keyed by this call's id — never taken from the tool's own return value (see #executeProvider's class-level comment). */
    usage?: MessageUsage[];
}

/** Built-in tool, always available alongside whatever MCP tools are allowed — lets the model trigger memory compaction itself instead of only having it happen as a hidden side-effect. */
const COMPACT_MEMORY_TOOL_NAME = "compact_memory";

const COMPACT_MEMORY_TOOL: ToolSchema = {
    name: COMPACT_MEMORY_TOOL_NAME,
    description: "Compact the conversation so far into a persistent memory note and reset the active working context. Nothing is lost — the summary is shown in every future system prompt's MEMORY section. Call this proactively when the conversation has grown long, or whenever asked to free up context.",
    inputs: [
        {
            name: "new_memory",
            type: "string",
            description: "A compact summary capturing every important fact, decision, and pending task from the conversation so far. Replaces the current MEMORY note.",
            required: true,
        },
    ],
};

export class BaseAgent {
    #maxMemorizeToken: number;
    #safetyPolicies: string = "";
    #instruction: string = "";

    #allSkills: Skill[] = [];
    #allowedTools: MCPTool[] = [];

    /** Built once, lazily, from all skills/tools — never changes after that, so it's identical (and cache-friendly) across every turn and every iteration of the run loop. */
    #systemPrompt?: string;

    #compactMemory: string = "";

    /** Retired messages only — whatever a `compact_memory` call has already folded out of #messagesCompact. Disjoint from #messagesCompact, not a superset of it: a message lives in exactly one of the two at any time. The complete history is the concatenation of this and #messagesCompact, not this array alone. */
    #retiredMessages: Message[] = [];

    #runningProcess: boolean = false;
    #incomingRun: any = [];

    /** The working context currently replayed to the provider every turn. Everything gets pushed here first; #compact() moves it into #retiredMessages and clears this. */
    #messagesCompact: Message[] = [];

    #stopSignal = false;
    /** Set for the duration of the in-flight `#mainProvider.chat()` call in the run loop below, and cleared right after — lets `immediateStop()` cancel that specific call without needing to know anything about the loop's internal state. */
    #currentAbortController?: AbortController;

    #mcpClient: MCPClient;

    /** Every provider this agent was given, keyed by role — see agent-providers.ts. Only ever touched from #executeProvider — never handed to a tool or across a transport boundary directly (see MCP#executeProvider in mcp.ts). */
    #providers: ProviderRegistry;
    #mainProvider: AIProvider;

    #usageByToolCallId: Map<string, MessageUsage[]> = new Map();

    /** See the `features.executeProviderFromMCPTool` constructor option — off by default. */
    #executeProviderFromMCPTool: boolean = false;

    constructor({
        safetyPolicies = "",
        instruction,
        allowedTools,
        aiProvider,
        mcpClient,
        initData = {
            compactMemory: "",
            retiredMessages: [],
            messagesCompact: [],
        },
        skills = [],
        maxMemorizeToken,
        features: {
            executeProviderFromMCPTool = false
        } = {
            executeProviderFromMCPTool: false
        }
    }: {
        safetyPolicies?: string;
        instruction: string;
        allowedTools: MCPTool[];
        aiProvider: AgentProvidersInput;
        mcpClient: MCPClient;
        skills?: Skill[];
        /** If omitted, derived from the main provider's reported context window (via getCapabilities()) instead of a hardcoded constant, so the memory-compaction trigger point scales with whatever model is actually in use. */
        maxMemorizeToken?: number;
        initData?: {
            compactMemory: string;
            /** Retired messages only, disjoint from messagesCompact — see the field comment on #retiredMessages. Each Message carries its own `usage`/`timestamp`, which is what token accounting is now derived from (see getCompactTotalTokens()/getFullTotalToken()). */
            retiredMessages: Message[];
            /** The working context currently replayed to the provider every turn. */
            messagesCompact: Message[];
        },
        /** Off by default — opt-in flags for capabilities that widen what a tool can trigger through this agent. */
        features?: {
            /** Whether a tool's `execute()` may call `mcp.executeProvider(...)` to reach a registered `AIProvider` directly. Off by default: a tool that can trigger an arbitrary provider call is a bigger trust surface than one that only returns data to the model, so it needs an explicit opt-in. When false, #executeProvider throws instead of dispatching. */
            executeProviderFromMCPTool?: boolean;
        }
    }) {
        this.#safetyPolicies = safetyPolicies;
        this.#instruction = instruction;
        this.#allowedTools = allowedTools;
        this.#mcpClient = mcpClient;
        this.#compactMemory = initData.compactMemory;
        this.#retiredMessages = initData.retiredMessages;
        this.#messagesCompact = initData.messagesCompact;
        this.#allSkills = skills;
        this.#executeProviderFromMCPTool = executeProviderFromMCPTool;

        this.#providers = resolveAgentProviders(aiProvider);
        this.#mainProvider = this.#providers.getMain();
        this.#mcpClient.setExecuteProviderHandler(this.#executeProvider.bind(this));

        this.#maxMemorizeToken = maxMemorizeToken ?? this.#deriveMaxMemorizeToken();
    }

    #deriveMaxMemorizeToken(): number {
        const caps = this.#mainProvider.getCapabilities();
        const ratio = caps.safeUsageRatio ?? 0.5;
        return Math.floor(caps.contextWindow * ratio);
    }

    async #getAllToolSchemas(): Promise<ToolSchema[]> {
        const mcpTools = (await this.#mcpClient.getTools())
            .filter(t => this.#allowedTools.map(t => t.getOptions().name).includes(t.name));
        return [...mcpTools, COMPACT_MEMORY_TOOL];
    }

    #buildSkillsAndMemoryBlock(skills: Skill[]): string {
        return `${skills && `
SKILLS:
${skills.map(skill => (`${skill.getSkill().name} - ${skill.getSkill().description}
${skill.getSkill().instructions}
\n`))}
`}

MEMORY:
${this.#compactMemory || "(empty)"}

INSTRUCTIONS:
${this.#instruction}
`;
    }

    #buildNativeSystemPrompt(skills: Skill[]): string {
        return `You are an assistant with access to tools (provided natively). Think step by step. After each tool result, continue reasoning or call another tool as needed. Never invent tool results.
${this.#buildSkillsAndMemoryBlock(skills)}`;
    }

    /** Built from the fixed set of skills/tools plus the current MEMORY note, and cached until #compact() invalidates it (the cache is only ever a stable prefix for provider-side prompt caching between compactions, not across one). */
    #getOrBuildSystemPrompt(): string {
        if (this.#systemPrompt !== undefined) {
            return this.#systemPrompt;
        }

        this.#systemPrompt = this.#buildNativeSystemPrompt(this.#allSkills);

        return this.#systemPrompt;
    }

    /** Injected as a normal user turn once the running context crosses `#maxMemorizeToken`, so the model calls `compact_memory` itself on its next turn instead of the reset happening as a hidden side-effect. */
    #buildForceCompactPrompt(): string {
        return `You're nearing the safe context limit for this conversation. Before doing anything else, call the "${COMPACT_MEMORY_TOOL_NAME}" tool with a "new_memory" summary capturing every important fact, decision, and pending task so far.`;
    }

    /** Folds the working context into the retired-message archive and stores the new running summary. Shared by voluntary and forced compaction — both go through the same `compact_memory` tool call. Messages live in exactly one of messagesCompact/retiredMessages at a time (see the class-level note above #retiredMessages) — no lifetime counters to roll over separately, since usage travels with each message itself. */
    #compact(newMemory: string): string {
        this.#compactMemory = newMemory;
        this.#retiredMessages.push(...this.#messagesCompact);
        this.#messagesCompact = [];
        this.#systemPrompt = undefined;
        return "Memory compacted. Continue where you left off, using MEMORY above for context.";
    }

    async #executeProvider(toolCallId: string, type: ProviderType, input: Record<string, any>): Promise<{ output: Record<string, any> }> {
        if (!this.#executeProviderFromMCPTool) {
            throw new Error("BaseAgent#executeProvider: this feature is disabled by agent features (features.executeProviderFromMCPTool is false).");
        }

        const usage = this.#usageByToolCallId.get(toolCallId);
        if (!usage) {
            throw new Error(`BaseAgent#executeProvider: "${toolCallId}" is not a currently active tool call.`);
        }

        const provider = this.#providers.getProvider(type);
        if (!provider) {
            throw new Error(`BaseAgent#executeProvider: no provider available for type "${type}".`);
        }

        const result = await provider.chat([
            // { role: "system", content: this.#safetyPolicies }, // WE NEED IMPLEMENT SAFETY POLICY LATER BUT WE DISABLE THIS FEATURE BY DEFAULT FOR NOW
            { role: "user", ...input },
        ]);

        if (result.cost !== undefined) {
            usage.push({ type, unit: "cost", cost: result.cost });
        } else {
            usage.push({
                type,
                unit: "tokens",
                inputMissTokens: (result.inputMissTokens ?? 0) + (result.inputCacheTokens ?? 0),
                inputCacheTokens: 0,
                outputTokens: result.outputTokens ?? 0,
            });
        }

        return { output: { content: result.content } };
    }

    async #dispatchTool(id: string, toolName: string, inputs: Record<string, any>): Promise<DispatchedToolResult> {
        if (toolName === COMPACT_MEMORY_TOOL_NAME) {
            if (typeof inputs?.new_memory === "string") {
                return { id, name: toolName, resultText: this.#compact(inputs.new_memory) };
            }
            return { id, name: toolName, resultText: `Error: ${COMPACT_MEMORY_TOOL_NAME} requires new_memory:string, got ${JSON.stringify(inputs)}` };
        }

        if (!this.#allowedTools.map(t => t.getOptions().name).includes(toolName)) {
            return { id, name: toolName, resultText: `Error: tool "${toolName}" not found or not allowed.` };
        }

        this.#usageByToolCallId.set(id, []);
        try {
            const output = await this.#mcpClient.callTool(toolName, inputs, id);
            return { id, name: toolName, resultText: JSON.stringify(output.output), usage: this.#usageByToolCallId.get(id) };
        } catch (err: any) {
            return { id, name: toolName, resultText: `Error: ${err?.message ?? String(err)}` };
        } finally {
            this.#usageByToolCallId.delete(id);
        }
    }

    async stop(): Promise<void> {
        return this.safeStop();
    }

    async safeStop(): Promise<void> {
        this.#stopSignal = true;
        return new Promise((res, rej) => {
            let timeout: any = undefined;
            const inter = setInterval(() => {
                if (this.#stopSignal == false) {
                    clearInterval(inter);
                    if (timeout)
                        clearTimeout(timeout);
                    res();
                }
            }, 100);
            timeout = setTimeout(() => {
                clearInterval(inter);
                rej(new Error("Unable to stop current agent execution flow!"));
            }, 240000);
        });
    }

    immediateStop(): void {
        this.#stopSignal = true;
        this.#currentAbortController?.abort();
    }

    async run(prompt: string, streamCallback?: StreamCallback): Promise<void> {
        if (this.#runningProcess) {
            const result = await new Promise((res, rej) => {
                let timeout: any = null;
                const interval = setInterval(() => {
                    if (this.#runningProcess == false) {
                        res(null);
                        clearInterval(interval);
                        if (timeout)
                            clearTimeout(timeout);
                    }
                }, 100);
                timeout = setTimeout(() => {
                    clearInterval(interval);
                    rej("TimeOut RUN agent");
                }, 240000);
                this.#incomingRun.push({ prompt, timeout, interval, res });
            });
            if (result)
                return;
            else {
                this.#incomingRun = [];
            }
        }

        this.#runningProcess = true;

        if (!this.#mainProvider.getCapabilities().supportsTools) {
            throw new Error(
                "BaseAgent.run: the main provider must support native tool-calling (getCapabilities().supportsTools === true). " +
                "Legacy JSON-in-text tool-call dispatch is no longer supported in the main agent loop."
            );
        }

        const allTools = await this.#getAllToolSchemas();

        let keepGoing = true;
        let firstIteration = true;

        do {
            if (this.#stopSignal) {
                this.#stopSignal = false;
                break;
            }

            const systemPrompt = this.#getOrBuildSystemPrompt();

            if (firstIteration) {
                const userMessage: Message = { role: "user", content: prompt, timestamp: Date.now() };
                this.#messagesCompact.push(userMessage);
                await streamCallback?.({ role: "user", content: prompt, done: true });
            }

            const abortController = new AbortController();
            this.#currentAbortController = abortController;

            let chat: ChatResponse;
            try {
                chat = await this.#mainProvider.chat([
                    { role: "system", content: this.#safetyPolicies },
                    { role: "system", content: systemPrompt },
                    ...this.#messagesCompact
                ], streamCallback, allTools, abortController.signal);
            } catch (err) {
                this.#currentAbortController = undefined;
                if (abortController.signal.aborted) {
                    this.#stopSignal = false;
                    break;
                }
                throw err;
            }
            this.#currentAbortController = undefined;

            firstIteration = false;

            const assistantMessage: Message = {
                role: "assistant",
                content: chat.content,
                timestamp: Date.now(),
                usage: [{ type: "main", unit: "tokens", inputMissTokens: chat.inputMissTokens ?? 0, inputCacheTokens: chat.inputCacheTokens ?? 0, outputTokens: chat.outputTokens ?? 0 }],
                ...(chat.toolCalls?.length ? { toolCalls: chat.toolCalls } : {}),
                ...(chat.thinking ? { thinking: chat.thinking } : {}),
                ...(chat.providerThinking ? { providerThinking: chat.providerThinking } : {}),
            };
            this.#messagesCompact.push(assistantMessage);

            let calledAnyTool = false;

            const nativeCalls: ToolCallRequest[] = chat.toolCalls ?? [];
            for (const call of nativeCalls) {
                calledAnyTool = true;
                const result = await this.#dispatchTool(call.id, call.name, call.inputs);
                const toolMessage: Message = {
                    role: "tool",
                    content: result.resultText,
                    toolCallId: result.id,
                    toolName: result.name,
                    timestamp: Date.now(),
                    usage: result.usage ?? [],
                };
                this.#messagesCompact.push(toolMessage);
                await streamCallback?.({ role: "tool", content: result.resultText, done: true, toolCallId: result.id, toolName: result.name, usage: { inputMissTokens: 0, inputCacheTokens: 0, outputTokens: 0 } });
            }

            const overMemoryBudget = this.#sumTokensForType("main", this.#messagesCompact).inputMiss > this.#maxMemorizeToken;

            if (overMemoryBudget) {
                const forcePrompt: Message = { role: "user", content: this.#buildForceCompactPrompt(), timestamp: Date.now(), hidden: true };
                this.#messagesCompact.push(forcePrompt);
                await streamCallback?.({ role: "user", content: forcePrompt.content!, done: true, hidden: true });
            }

            const stopAfterToolCall = this.#allowedTools.filter(t => nativeCalls.map(nc => nc.name).includes(t.getOptions().name)).find(t => t.getOptions().stopIterationAfterUsingThisTool)


            keepGoing = (!stopAfterToolCall && calledAnyTool) || overMemoryBudget;
        } while (keepGoing && this.#incomingRun.length == 0);
        if (this.#incomingRun.length > 1) {
            for (let i = 0; i < this.#incomingRun.length - 1; i++) {
                const run = this.#incomingRun[i];
                const queuedMessage: Message = { role: "user", content: run.prompt, timestamp: Date.now() };
                this.#messagesCompact.push(queuedMessage);
                await streamCallback?.({ role: "user", content: run.prompt, done: true });
                clearTimeout(run.timeout);
                clearInterval(run.interval);
                run.res(true);
            }
        }
        this.#runningProcess = false;
    }

    #sumTokensForType(type: ProviderType, messages: Message[]): { inputMiss: number; inputCache: number; output: number } {
        let inputMiss = 0, inputCache = 0, output = 0;
        for (const m of messages) {
            for (const u of m.usage ?? []) {
                if (u.type === type && u.unit === "tokens") {
                    inputMiss += u.inputMissTokens;
                    inputCache += u.inputCacheTokens;
                    output += u.outputTokens;
                }
            }
        }
        return { inputMiss, inputCache, output };
    }

    #sumCostForType(type: ProviderType, messages: Message[]): number {
        let cost = 0;
        for (const m of messages) {
            for (const u of m.usage ?? []) {
                if (u.type === type && u.unit === "cost") {
                    cost += u.cost;
                }
            }
        }
        return cost;
    }

    getCurrentAgentStates() {
        return {
            compactMemory: this.#compactMemory,
            retiredMessages: this.#retiredMessages,
            messagesCompact: this.#messagesCompact,
        };
    }

    getCompactTotalTokens(type: ProviderType) {
        const t = this.#sumTokensForType(type, this.#messagesCompact);
        return { total: t.inputMiss + t.inputCache + t.output, inputHit: t.inputCache, inputMiss: t.inputMiss, output: t.output };
    }

    getFullTotalToken(type: ProviderType) {
        const t = this.#sumTokensForType(type, [...this.#retiredMessages, ...this.#messagesCompact]);
        return { total: t.inputMiss + t.inputCache + t.output, inputHit: t.inputCache, inputMiss: t.inputMiss, output: t.output };
    }

    getCompactTotalCost(type: ProviderType): number {
        return this.#sumCostForType(type, this.#messagesCompact);
    }

    getFullTotalCost(type: ProviderType): number {
        return this.#sumCostForType(type, [...this.#retiredMessages, ...this.#messagesCompact]);
    }
}

export default BaseAgent;