import type { AIProvider, Message, StreamCallback, ToolSchema, ToolCallRequest, ChatResponse } from "./ai-provider.js";
import type MCPClient from "./mcp-client.js";
import type MCPTool from "./mcp.js";
import type Skill from "./skill.js";
import type { MCPToolOutput } from "./mcp.js";
import { ImageDescriber } from "./image-describer.js";
import { resolveAgentProviders, type AgentProvidersInput } from "./agent-providers.js";

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
    /** Text ultimately shown to the model — either the tool's own text output, or (for image outputs) either a raw image handoff marker or a description. */
    resultText: string;
    /** Present only when the tool produced an image AND the agent is configured to hand images to the main model directly (rather than describing them). */
    imagePart?: { image: string; mimeType?: string };
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
    #instruction: string = "";

    #allSkills: Skill[] = [];
    #allowedTools: MCPTool<any>[] = [];

    /** Built once, lazily, from all skills/tools — never changes after that, so it's identical (and cache-friendly) across every turn and every iteration of the run loop. */
    #systemPrompt?: string;

    #memory: string = "";

    #messagesFull: Message[] = [];

    #runningProcess: boolean = false;
    #incomingRun: any = [];

    #fullInputMissTokens = 0;
    #fullInputHitTokens = 0;
    #fullOutputTokens = 0;

    #messagesCompact: Message[] = [];
    #currentInputMissTokens = 0;
    #currentInputHitTokens = 0;
    #currentLastOutputTokens = 0;
    #currentOutputTokens = 0;

    // Usage from ImageDescriber calls (see #resolveToolOutputForModel) — tracked
    // separately from the main loop's counters above since each call is a fresh,
    // standalone chat with no history to replay, unlike the main loop. No hit/miss
    // split here (unlike #currentInput*Tokens above) — there's nothing to have been
    // cached from a prior turn, so every input token is a miss.
    #imageInputMissTokens = 0;
    #imageOutputTokens = 0;

    #stopSignal = false;
    /** Set for the duration of the in-flight `#mainProvider.chat()` call in the run loop below, and cleared right after — lets `immediateStop()` cancel that specific call without needing to know anything about the loop's internal state. */
    #currentAbortController?: AbortController;

    #mcpClient: MCPClient;

    #mainProvider: AIProvider;
    #imageProvider?: AIProvider;

    constructor({
        instruction,
        allowedTools,
        aiProvider,
        mcpClient,
        initData = {
            memory: "",
            messagesFull: [],
            fullInputMissTokens: 0,
            fullInputHitTokens: 0,
            fullOutputTokens: 0,
            messagesCompact: [],
            currentInputMissTokens: 0,
            currentInputHitTokens: 0,
            currentOutputTokens: 0,
        },
        skills = [],
        maxMemorizeToken,
    }: {
        instruction: string;
        allowedTools: MCPTool<any>[];
        aiProvider: AgentProvidersInput;
        mcpClient: MCPClient;
        skills?: Skill[];
        /** If omitted, derived from the main provider's reported context window (via getCapabilities()) instead of a hardcoded constant, so the memory-compaction trigger point scales with whatever model is actually in use. */
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
            /** Optional so snapshots taken before image-usage tracking existed still load — missing values default to 0. */
            imageInputMissTokens?: number;
            imageOutputTokens?: number;
        }
    }) {
        this.#instruction = instruction;
        this.#allowedTools = allowedTools;
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
        this.#imageInputMissTokens = initData.imageInputMissTokens ?? 0;
        this.#imageOutputTokens = initData.imageOutputTokens ?? 0;
        this.#allSkills = skills;

        const resolved = resolveAgentProviders(aiProvider);
        this.#mainProvider = resolved.main;
        this.#imageProvider = resolved.image;

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
${this.#memory || "(empty)"}

INSTRUCTIONS:
${this.#instruction}
`;
    }

    #buildNativeSystemPrompt(skills: Skill[]): string {
        return `You are an assistant with access to tools (provided natively). Think step by step. After each tool result, continue reasoning or call another tool as needed. Never invent tool results.
${this.#buildSkillsAndMemoryBlock(skills)}`;
    }

    /** Built once from the full, fixed set of skills/tools and cached — identical on every turn, so it's also a stable prefix for provider-side prompt caching. */
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

    /** Rolls the current (working) token counters into the lifetime totals, clears the working context, and stores the new running summary. Shared by voluntary and forced compaction — both go through the same `compact_memory` tool call. */
    #compactMemory(newMemory: string): string {
        this.#memory = newMemory;
        this.#messagesCompact = [];
        this.#fullInputHitTokens += this.#currentInputHitTokens;
        this.#fullInputMissTokens += this.#currentInputMissTokens;
        this.#fullOutputTokens += this.#currentOutputTokens;
        this.#currentInputHitTokens = 0;
        this.#currentInputMissTokens = 0;
        this.#currentOutputTokens = 0;
        this.#currentLastOutputTokens = 0;
        return "Memory compacted. Continue where you left off, using MEMORY above for context.";
    }

    async #resolveToolOutputForModel(toolName: string, output: MCPToolOutput): Promise<{ text: string; imagePart?: { image: string; mimeType?: string } }> {
        if (output.type === "text") {
            return { text: JSON.stringify(output.output) };
        }

        // output.type === "image"
        const { image, mimeType, focusHint, ...rest } = output.output;

        if (!this.#imageProvider) {
            return {
                text: JSON.stringify({
                    error: `${toolName} produced an image, but image description is not supported in this session (no provider with image support is configured).`,
                    ...rest,
                }),
            };
        }

        if (this.#imageProvider === this.#mainProvider) {
            return {
                text: JSON.stringify({ message: `${toolName} produced an image, attached.`, ...rest }),
                imagePart: { image, mimeType },
            };
        }

        const describer = new ImageDescriber(this.#imageProvider);
        const result = await describer.describe(image, mimeType, focusHint);

        this.#imageInputMissTokens += result.inputTokens;
        this.#imageOutputTokens += result.outputTokens;

        return { text: JSON.stringify({ description: result.description, ...rest }) };
    }

    async #dispatchTool(id: string, toolName: string, inputs: Record<string, any>): Promise<DispatchedToolResult> {
        if (toolName === COMPACT_MEMORY_TOOL_NAME) {
            if (typeof inputs?.new_memory === "string") {
                return { id, name: toolName, resultText: this.#compactMemory(inputs.new_memory) };
            }
            return { id, name: toolName, resultText: `Error: ${COMPACT_MEMORY_TOOL_NAME} requires new_memory:string, got ${JSON.stringify(inputs)}` };
        }

        if (!this.#allowedTools.map(t => t.getOptions().name).includes(toolName)) {
            return { id, name: toolName, resultText: `Error: tool "${toolName}" not found or not allowed.` };
        }

        try {
            const output = await this.#mcpClient.callTool(toolName, inputs);
            const resolved = await this.#resolveToolOutputForModel(toolName, output);
            return { id, name: toolName, resultText: resolved.text, imagePart: resolved.imagePart };
        } catch (err: any) {
            return { id, name: toolName, resultText: `Error: ${err?.message ?? String(err)}` };
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

        this.#runningProcess = true

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
                this.#messagesFull.push({ role: "user", content: prompt });
                this.#messagesCompact.push({ role: "user", content: prompt });
                await streamCallback?.({ role: "user", content: prompt, done: true });
            }

            const abortController = new AbortController();
            this.#currentAbortController = abortController;

            let chat: ChatResponse;
            try {
                chat = await this.#mainProvider.chat([
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
                ...(chat.toolCalls?.length ? { toolCalls: chat.toolCalls } : {}),
                ...(chat.thinking ? { thinking: chat.thinking } : {}),
                ...(chat.providerThinking ? { providerThinking: chat.providerThinking } : {}),
            };
            this.#messagesFull.push(assistantMessage);
            this.#messagesCompact.push(assistantMessage);

            this.#currentInputHitTokens += this.#currentInputMissTokens;
            this.#currentInputMissTokens += chat.inputTokens - this.#currentInputMissTokens;
            this.#currentOutputTokens += chat.outputTokens;
            this.#currentLastOutputTokens = chat.outputTokens;

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
                    ...(result.imagePart ? { parts: [{ type: "text", text: result.resultText }, { type: "image", ...result.imagePart }] } : {}),
                };
                this.#messagesFull.push(toolMessage);
                this.#messagesCompact.push(toolMessage);
                await streamCallback?.({ role: "tool", content: result.resultText, done: true, toolCallId: result.id, toolName: result.name });
            }

            const overMemoryBudget = this.#currentInputMissTokens + this.#currentLastOutputTokens > this.#maxMemorizeToken;

            if (overMemoryBudget) {
                const forcePrompt: Message = { role: "user", content: this.#buildForceCompactPrompt() };
                this.#messagesFull.push(forcePrompt);
                this.#messagesCompact.push(forcePrompt);
                await streamCallback?.({ role: "user", content: forcePrompt.content!, done: true });
            }

            const stopAfterToolCall = this.#allowedTools.filter(t => nativeCalls.map(nc => nc.name).includes(t.getOptions().name)).find(t => t.getOptions().stopIterationAfterUsingThisTool)


            keepGoing = (!stopAfterToolCall && calledAnyTool) || overMemoryBudget;
        } while (keepGoing && this.#incomingRun.length == 0);
        if (this.#incomingRun.length > 1) {
            for (let i = 0; i < this.#incomingRun.length - 1; i++) {
                const run = this.#incomingRun[i];
                this.#messagesFull.push({ role: "user", content: run.prompt });
                this.#messagesCompact.push({ role: "user", content: run.prompt });
                await streamCallback?.({ role: "user", content: run.prompt, done: true });
                clearTimeout(run.timeout);
                clearInterval(run.interval);
                run.res(true);
            }
        }
        this.#runningProcess = false;
    }

    /** Full recoverable snapshot of agent state — pass this back in as `initData` on a fresh BaseAgent instance (e.g. after a process restart) to resume exactly where this one left off. Persist the return value to disk (or wherever) whenever you want a recovery point. */
    getCurrentAgentStates() {
        return {
            memory: this.#memory,
            messagesFull: this.#messagesFull,
            fullInputMissTokens: this.#fullInputMissTokens,
            fullInputHitTokens: this.#fullInputHitTokens,
            fullOutputTokens: this.#fullOutputTokens,
            messagesCompact: this.#messagesCompact,
            currentInputMissTokens: this.#currentInputMissTokens,
            currentInputHitTokens: this.#currentInputHitTokens,
            currentOutputTokens: this.#currentOutputTokens,
            imageInputMissTokens: this.#imageInputMissTokens,
            imageOutputTokens: this.#imageOutputTokens,
        };
    }
    /** Lifetime total across the main loop (current + all prior compacted segments) AND every ImageDescriber call this agent has made. */
    getTotalTokens() {
        return {
            total: this.#currentInputHitTokens + this.#currentInputMissTokens + this.#currentOutputTokens + this.#fullInputHitTokens + this.#fullInputMissTokens + this.#fullOutputTokens + this.#imageInputMissTokens + this.#imageOutputTokens,
            inputHit: this.#currentInputHitTokens + this.#fullInputHitTokens,
            inputMiss: this.#currentInputMissTokens + this.#fullInputMissTokens + this.#imageInputMissTokens,
            output: this.#currentOutputTokens + this.#fullOutputTokens + this.#imageOutputTokens
        };
    }

    getCurrentTotalTokens() {
        return {
            total: this.#currentInputHitTokens + this.#currentInputMissTokens + this.#currentOutputTokens,
            inputHit: this.#currentInputHitTokens,
            inputMiss: this.#currentInputMissTokens,
            output: this.#currentOutputTokens
        };
    }

    /** Usage from ImageDescriber calls only (see #resolveToolOutputForModel) — not included in getCurrentTotalTokens()/getFullTotalTokens() since it isn't part of the main loop's current/full split, but it IS folded into getTotalTokens()'s grand total. Each call is a fresh, standalone chat, so there's no hit/miss split to make — inputHit is always 0, every input token counts as inputMiss. */
    getImageTotalTokens() {
        return {
            total: this.#imageInputMissTokens + this.#imageOutputTokens,
            inputHit: 0,
            inputMiss: this.#imageInputMissTokens,
            output: this.#imageOutputTokens
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