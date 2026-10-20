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

export interface AgentState {
    compactMemory: string;
    retiredMessages: Message[];
    messagesCompact: Message[];
}

interface DispatchedToolResult {
    id: string;
    name: string;
    /** Text ultimately shown to the model — the tool's own (JSON-stringified) output. Never includes `usage` — that's a side channel onto the resulting Message, not something the model reads. */
    resultText: string;
    /** Real usage recorded by #executeProvider for every `mcp.executeProvider(...)` call this tool made, keyed by this call's id — never taken from the tool's own return value (see #executeProvider's class-level comment). */
    usage?: MessageUsage[];
    compacted?: boolean;
    continueAfterCompact?: boolean;
}

/** Built-in tool, always available alongside whatever MCP tools are allowed — lets the model trigger memory compaction itself instead of only having it happen as a hidden side-effect. */
const COMPACT_MEMORY_TOOL_NAME = "compact_memory";

const COMPACT_CONFIRMATION_MESSAGE = "Memory compacted. Continue where you left off, using MEMORY above for context.";

/** The user's latest message is carried across a compaction verbatim up to this many characters; past it, the head and tail are kept. */
const CARRIED_USER_MESSAGE_CHARS = 6000;

const COMPACT_MEMORY_TOOL: ToolSchema = {
    name: COMPACT_MEMORY_TOOL_NAME,
    description: "Compact the conversation so far into a persistent memory note and reset the active working context. The note is shown in every future system prompt's MEMORY section and the user's latest message is carried over verbatim, but everything else in the working context (tool results, file contents, your own replies) is dropped — write the note so you can carry on from it alone. Call this proactively when the conversation has grown long, or whenever asked to free up context.",
    inputs: [
        {
            name: "new_memory",
            type: "string",
            description: "The note that replaces the current MEMORY, written as a hand-over to yourself: (1) the user's goal and every request they made, with their exact constraints and preferences; (2) what is done so far, with concrete names (files, commands, ids, results); (3) decisions made and why; (4) what is in progress and the exact next steps; (5) open questions and anything the user is waiting for. Refer to files by path instead of copying their contents — list the ones to read again in files_to_reread. Complete about state, brief about prose.",
            required: true,
        },
        {
            name: "language",
            type: "string",
            description: "The language the user writes in and you reply in (e.g. \"Persian\", \"English\"). You keep replying in it after the compaction.",
            required: false,
        },
        {
            name: "files_to_reread",
            type: "array",
            description: "Files you need to read again to carry on, as {path: string, reason: string}[] — e.g. the file you were editing, a spec or plan the user gave. Cheaper than copying their contents into new_memory. Omit when none.",
            required: false,
        },
        {
            name: "continue_iterating",
            type: "boolean",
            description: "Whether you need to keep going after this call — true if you still have more to do (e.g. more tool calls, or you haven't answered the user's request yet), false if you're compacting after already giving the user their final answer this turn and there's nothing left to do. When false, the agent stops and returns control after this call instead of taking another turn. Defaults to true.",
            required: false,
            default: true,
        },
    ],
};

interface RereadFile {
    path: string;
    reason?: string;
}

/** files_to_reread as the model sent it: objects, or bare paths. */
function rereadFiles(value: unknown): RereadFile[] {
    const files: RereadFile[] = [];
    for (const entry of Array.isArray(value) ? value : []) {
        if (typeof entry === "string") {
            if (entry.trim()) files.push({ path: entry.trim() });
            continue;
        }
        const path = typeof entry?.path === "string" ? entry.path.trim() : "";
        const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
        if (path) files.push({ path, ...(reason ? { reason } : {}) });
    }
    return files.slice(0, 30);
}

/** The memory note as stored: the model's note, then the language and the files to read again, so both survive with it (and with a restore from AgentState). */
function composeMemory(note: string, language: string, files: RereadFile[]): string {
    const parts = [note.trim()];
    if (language) parts.push(`Conversation language: ${language} — keep replying to the user in ${language}.`);
    if (files.length) {
        parts.push(["Files to read again before continuing (their contents were not kept):", ...files.map((file) => `- ${file.path}${file.reason ? ` — ${file.reason}` : ""}`)].join("\n"));
    }
    return parts.join("\n\n");
}

function clip(text: string, max: number): string {
    if (text.length <= max) return text;
    const half = Math.floor((max - 40) / 2);
    return `${text.slice(0, half)}\n[… ${text.length - 2 * half} characters left out …]\n${text.slice(-half)}`;
}

export interface BaseAgentProps {
    safetyPolicies?: string;
    instruction: string;
    allowedTools: MCPTool[];
    aiProvider: AgentProvidersInput;
    mcpClient: MCPClient;
    skills?: Skill[];
    /** What a `compact_memory` note must also keep in this application (e.g. "the todo list's state"). Added to the compaction rules in the system prompt. */
    compactInstructions?: string;
    /** If omitted, derived from the main provider's reported context window (via getCapabilities()) instead of a hardcoded constant, so the memory-compaction trigger point scales with whatever model is actually in use. */
    maxMemorizeToken?: number;
    initData?: {
        compactMemory: string;
        /** Retired messages only, disjoint from messagesCompact — see the field comment on #retiredMessages. Each Message carries its own `usage`/`timestamp`, which is what token accounting is now derived from (see getCompactTotalTokens()/getFullTotalToken()). */
        retiredMessages: Message[];
        /** The working context currently replayed to the provider every turn. */
        messagesCompact: Message[];
    };
    /** Off by default — opt-in flags for capabilities that widen what a tool can trigger through this agent. */
    features?: {
        /** Whether a tool's `execute()` may call `mcp.executeProvider(...)` to reach a registered `AIProvider` directly. Off by default: a tool that can trigger an arbitrary provider call is a bigger trust surface than one that only returns data to the model, so it needs an explicit opt-in. When false, #executeProvider throws instead of dispatching. */
        executeProviderFromMCPTool?: boolean;
    };
};

export class BaseAgent {
    #maxMemorizeToken: number;
    #safetyPolicies: string = "";
    #instruction: string = "";
    #compactInstructions: string = "";

    #allSkills: Skill[] = [];
    #allowedTools: MCPTool[] = [];

    /** Built once, lazily, from all skills/tools — never changes after that, so it's identical (and cache-friendly) across every turn and every iteration of the run loop. */
    #systemPrompt?: string;

    #compactMemory: string = "";
    /** From the latest `compact_memory` call, for the message the model reads right after it. */
    #compactLanguage: string = "";
    #compactFiles: RereadFile[] = [];

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
        compactInstructions = "",
        maxMemorizeToken,
        features: {
            executeProviderFromMCPTool = false
        } = {
            executeProviderFromMCPTool: false
        }
    }: BaseAgentProps) {
        this.#safetyPolicies = safetyPolicies;
        this.#instruction = instruction;
        this.#compactInstructions = compactInstructions;
        this.#allowedTools = allowedTools;
        this.#mcpClient = mcpClient;
        this.#compactMemory = initData.compactMemory;
        this.#retiredMessages = this.#repairHistory(initData.retiredMessages);
        this.#messagesCompact = this.#repairHistory(initData.messagesCompact);
        this.#allSkills = skills;
        this.#executeProviderFromMCPTool = executeProviderFromMCPTool;

        this.#providers = resolveAgentProviders(aiProvider);
        this.#mainProvider = this.#providers.getMain();
        this.#mcpClient.setExecuteProviderHandler(this.#executeProvider.bind(this));

        this.#maxMemorizeToken = maxMemorizeToken ?? this.#deriveMaxMemorizeToken();
    }

    #repairHistory(messages: Message[]): Message[] {
        const repaired: Message[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]!;
            repaired.push(msg);

            if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
                const pendingIds = new Set(msg.toolCalls.map((tc) => tc.id));

                let j = i + 1;
                while (j < messages.length && messages[j]!.role === "tool") {
                    const toolMsg = messages[j]!;
                    if (toolMsg.toolCallId && pendingIds.has(toolMsg.toolCallId)) {
                        pendingIds.delete(toolMsg.toolCallId);
                    }
                    repaired.push(toolMsg);
                    i = j;
                    j++;
                }

                for (const missingId of pendingIds) {
                    const missingCall = msg.toolCalls.find((tc) => tc.id === missingId);
                    repaired.push({
                        role: "tool",
                        toolCallId: missingId,
                        toolName: missingCall?.name ?? "unknown",
                        content: JSON.stringify({
                            error: "Tool call was interrupted and no result was recorded. Treat as failed.",
                        }),
                    });
                }
            }
        }

        return repaired;
    }

    #deriveMaxMemorizeToken(): number {
        const caps = this.#mainProvider.getCapabilities();
        const ratio = caps.safeUsageRatio ?? 0.5;
        return Math.floor(caps.contextWindow * ratio);
    }

    async #getAllToolSchemas(): Promise<ToolSchema[]> {
        const allowed = new Map(this.#allowedTools.map(t => [t.getOptions().name, t.getOptions()]));
        const mcpTools = (await this.#mcpClient.getTools())
            .filter(t => allowed.has(t.name))
            // A remote tool that publishes no inputs (a bare proxy that only forwards calls) takes the
            // schema this agent was given for it, so the model still sees its parameters.
            .map(t => {
                const own = allowed.get(t.name)!;
                return (!t.inputs || t.inputs.length === 0) && own.inputs?.length
                    ? { name: t.name, description: own.description || t.description, inputs: own.inputs }
                    : t;
            });
        return [...mcpTools, COMPACT_MEMORY_TOOL];
    }

    #buildSkillsAndMemoryBlock(skills: Skill[]): string {
        return `${skills && `
SKILLS:
${skills.map(skill => (`${skill.getSkill().name} - ${skill.getSkill().description}
${skill.getSkill().instructions}
\n`))}
`}

COMPACT SESSION MEMORY:
${this.#compactMemory || "(empty)"}

COMPACTION RULES:
When you call ${COMPACT_MEMORY_TOOL_NAME}, only your note, the language, the files to read again and the user's latest message survive; every tool result and file content is dropped. Keep the user's requests and constraints, what is done, the decisions, and the exact next steps; name files by path and list the ones you'll need in files_to_reread instead of copying them. After a compaction, read those files first, then carry on with the next step without asking the user to repeat themselves, and keep replying in the user's language.${this.#compactInstructions ? `\n${this.#compactInstructions}` : ""}

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

    /** Injected as a normal user turn once the running context crosses `#maxMemorizeToken`, so the model calls `compact_memory` itself on its next turn instead of the reset happening as a hidden side-effect. Explicitly tells the model how to set `continue_iterating` on that call: `run()` trusts whatever the model decides here — including `true`, if the model still has unfinished work from before this nudge fired (e.g. mid-way through a multi-step task) — it doesn't force `continue_iterating` to `false` just because this is a response to a nudge rather than the user. */
    #buildForceCompactPrompt(): string {
        return `You're nearing the safe context limit for this conversation. Before doing anything else, call the "${COMPACT_MEMORY_TOOL_NAME}" tool with a "new_memory" hand-over note (the user's requests and constraints, what's done, decisions, the exact next steps), the user's "language", and "files_to_reread" for the files you'll need again (paths and why — don't copy their contents). This is routine housekeeping, not a new request from the user — set "continue_iterating" to true only if you still have unfinished work left from their last message (e.g. more steps of a task they asked for), false if you'd already given them everything they needed before this nudge fired.`;
    }

    /** Stores the new running summary from a successful `compact_memory` call and invalidates the cached system prompt, so the very next turn's system prompt is rebuilt with it rather than replaying the stale one. Deliberately does not touch `messagesCompact` — see #archiveWorkingContext(), which run() calls separately once the whole turn's tool calls have all been dispatched. */
    #applyCompactMemory(newMemory: string, language: string, files: RereadFile[]): void {
        this.#compactMemory = composeMemory(newMemory, language, files);
        this.#compactLanguage = language;
        this.#compactFiles = files;
        this.#systemPrompt = undefined;
    }

    /** The newest message the user wrote (not one this agent injected), carried across a compaction. */
    #latestUserMessage(): string | undefined {
        for (let i = this.#messagesCompact.length - 1; i >= 0; i--) {
            const message = this.#messagesCompact[i]!;
            if (message.role === "user" && !message.hidden && typeof message.content === "string" && message.content.trim()) return message.content;
        }
        return undefined;
    }

    /** What the model reads right after a compaction: the user's latest message verbatim, the files to read again, and the language to answer in. */
    #buildCompactConfirmation(latestUserMessage: string | undefined): string {
        const parts = [COMPACT_CONFIRMATION_MESSAGE];
        if (latestUserMessage) parts.push(`The user's latest message, verbatim:\n<<<\n${clip(latestUserMessage, CARRIED_USER_MESSAGE_CHARS)}\n>>>`);
        if (this.#compactFiles.length) parts.push(`Before the next step, read again: ${this.#compactFiles.map((file) => file.path).join(", ")}.`);
        if (this.#compactLanguage) parts.push(`Reply to the user in ${this.#compactLanguage}.`);
        return parts.join("\n\n");
    }

    #archiveWorkingContext(): void {
        this.#retiredMessages.push(...this.#messagesCompact);
        this.#messagesCompact = [];
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
            usage.push({ type, model: provider.getModel(), unit: "cost", cost: result.cost });
        } else {
            usage.push({
                type,
                model: provider.getModel(),
                unit: "tokens",
                inputMissTokens: (result.inputMissTokens ?? 0) + (result.inputCacheTokens ?? 0),
                inputCacheTokens: 0,
                outputTokens: result.outputTokens ?? 0,
            });
        }

        return { output: { content: result.content } };
    }

    /**
     * Whether `toolCallId` names a tool call this agent is running right now —
     * i.e. one whose usage bucket is open, so usage can still be attributed to it.
     */
    hasActiveToolCall(toolCallId: string): boolean {
        return this.#usageByToolCallId.has(toolCallId);
    }

    /**
     * Attribute usage to an in-flight tool call of this agent, so it lands on the
     * tool-result message the agent writes rather than being counted somewhere
     * outside the conversation.
     *
     * This exists for a swarm: there, `mcp.executeProvider(...)` is answered by
     * the swarm out of its own provider set, but the tokens were still spent on
     * behalf of one agent's tool call, and that agent is the only place they can
     * be recorded truthfully. The usage is written by the caller that actually
     * ran the provider — never from the tool's own output — so a tool cannot
     * report usage it did not spend.
     *
     * Returns false when the id is not an active tool call of this agent, which
     * lets a caller keep looking for the agent that owns it.
     */
    recordToolCallUsage(toolCallId: string, usage: MessageUsage[]): boolean {
        const bucket = this.#usageByToolCallId.get(toolCallId);
        if (!bucket) return false;
        bucket.push(...usage);
        return true;
    }

    async #dispatchTool(id: string, toolName: string, inputs: Record<string, any>): Promise<DispatchedToolResult> {
        if (toolName === COMPACT_MEMORY_TOOL_NAME) {
            if (typeof inputs?.new_memory === "string") {
                const language = typeof inputs?.language === "string" ? inputs.language.trim().slice(0, 60) : "";
                this.#applyCompactMemory(inputs.new_memory, language, rereadFiles(inputs?.files_to_reread));
                const continueAfterCompact = typeof inputs?.continue_iterating === "boolean" ? inputs.continue_iterating : true;
                return { id, name: toolName, resultText: COMPACT_CONFIRMATION_MESSAGE, compacted: true, continueAfterCompact };
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

    async run(prompt: string, streamCallback?: StreamCallback): Promise<boolean> {
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
                return false;
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
                usage: [{ type: "main", model: this.#mainProvider.getModel(), unit: "tokens", inputMissTokens: chat.inputMissTokens ?? 0, inputCacheTokens: chat.inputCacheTokens ?? 0, outputTokens: chat.outputTokens ?? 0 }],
                ...(chat.toolCalls?.length ? { toolCalls: chat.toolCalls } : {}),
                ...(chat.thinking ? { thinking: chat.thinking } : {}),
                ...(chat.providerThinking ? { providerThinking: chat.providerThinking } : {}),
            };
            this.#messagesCompact.push(assistantMessage);

            let calledAnyNonCompactTool = false;
            let compactedThisTurn = false;
            let compactRequestsContinue = true;

            const nativeCalls: ToolCallRequest[] = chat.toolCalls ?? [];
            for (const call of nativeCalls) {
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
                if (result.compacted) {
                    compactedThisTurn = true;
                    compactRequestsContinue = result.continueAfterCompact ?? true;
                } else {
                    calledAnyNonCompactTool = true;
                }
            }

            const compactKeepsGoing = compactedThisTurn && compactRequestsContinue;

            if (compactedThisTurn) {
                const latestUserMessage = this.#latestUserMessage();
                this.#archiveWorkingContext();
                if (compactKeepsGoing || calledAnyNonCompactTool) {
                    const compactedMessage: Message = { role: "user", content: this.#buildCompactConfirmation(latestUserMessage), timestamp: Date.now(), hidden: true };
                    this.#messagesCompact.push(compactedMessage);
                    await streamCallback?.({ role: "user", content: compactedMessage.content!, done: true, hidden: true });
                }
            }

            const overMemoryBudget = this.#sumTokensForType("main", this.#messagesCompact).inputMiss > this.#maxMemorizeToken;

            if (overMemoryBudget) {
                const forcePrompt: Message = { role: "user", content: this.#buildForceCompactPrompt(), timestamp: Date.now(), hidden: true };
                this.#messagesCompact.push(forcePrompt);
                await streamCallback?.({ role: "user", content: forcePrompt.content!, done: true, hidden: true });
            }

            const stopAfterToolCall = this.#allowedTools.filter(t => nativeCalls.map(nc => nc.name).includes(t.getOptions().name)).find(t => t.getOptions().stopIterationAfterUsingThisTool)

            const calledAnyTool = calledAnyNonCompactTool || compactKeepsGoing;

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

        if (this.#incomingRun.length == 0)
            return true;
        else
            return false;
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

    getCurrentAgentStates(): AgentState {
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