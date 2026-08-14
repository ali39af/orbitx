import type { AIProvider, Message, StreamCallback, ToolSchema, ToolCallRequest } from "./ai-provider.js";
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

    #stopSignal = false;

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

    #extractJson(str: string): ExtractedSegment[] {
        const segments: ExtractedSegment[] = [];
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

    async #extractToolCalls(content: string): Promise<ParsedToolCall[]> {
        return this.#extractJson(content)
            .filter((r): r is { type: "tool"; context: ParsedToolCall } => r.type === "tool")
            .map((t) => t.context);
    }

    async #getAllToolSchemas(): Promise<ToolSchema[]> {
        return (await this.#mcpClient.getTools())
            .filter(t => this.#allowedTools.map(t => t.getOptions().name).includes(t.name));
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

    #buildMemoryPrompt(): string {
        return `Summarize all important facts and pending tasks from this conversation.
Output only this JSON line, nothing else:
{"tool":"set_memory","inputs":{"new_memory":"<compact summary>"}}`;
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
        const description = await describer.describe(image, mimeType, focusHint);
        return { text: JSON.stringify({ description, ...rest }) };
    }

    async #dispatchTool(id: string, toolName: string, inputs: Record<string, any>): Promise<DispatchedToolResult> {
        if (toolName === "set_memory") {
            if (typeof inputs?.new_memory === "string") {
                this.#memory = inputs.new_memory;
                return { id, name: toolName, resultText: "Memory updated." };
            }
            return { id, name: toolName, resultText: `Error: set_memory requires new_memory:string, got ${JSON.stringify(inputs)}` };
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

    /** Legacy-path dispatch: takes a ParsedToolCall (from #extractJson) and returns the JSON string historically pushed as a `system`-role message. */
    async #dispatchLegacyTool(toolCall: ParsedToolCall): Promise<string> {
        const result = await this.#dispatchTool(toolCall.id, toolCall.tool, toolCall.inputs);
        if (toolCall.tool === "set_memory") {
            return result.resultText;
        }
        return JSON.stringify({ id: result.id, output: this.#safeParse(result.resultText) });
    }

    #safeParse(text: string): any {
        try { return JSON.parse(text); } catch { return text; }
    }

    async stop(): Promise<void> {
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

            const chat = await this.#mainProvider.chat([
                { role: "system", content: systemPrompt },
                ...this.#messagesCompact
            ], streamCallback, allTools);

            
            firstIteration = false;

            const assistantMessage: Message = chat.toolCalls?.length
                ? { role: "assistant", content: chat.content, toolCalls: chat.toolCalls }
                : { role: "assistant", content: chat.content };
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

            let memorizeEventHappened = false;

            if (this.#currentInputMissTokens + this.#currentLastOutputTokens > this.#maxMemorizeToken) {
                memorizeEventHappened = true;

                const memChat = await this.#mainProvider.chat([
                    { role: "system", content: systemPrompt },
                    ...this.#messagesCompact,
                    { role: "user", content: this.#buildMemoryPrompt() }
                ]);

                this.#currentInputHitTokens += this.#currentInputMissTokens;
                this.#currentInputMissTokens += memChat.inputTokens - this.#currentInputMissTokens;
                this.#currentOutputTokens += memChat.outputTokens;

                for (const mc of await this.#extractToolCalls(memChat.content)) {
                    const toolResponse = await this.#dispatchLegacyTool(mc);
                    await streamCallback?.({ role: "tool", content: toolResponse, done: true, toolCallId: mc.id, toolName: mc.tool });
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

            if (!calledAnyTool && memorizeEventHappened) {
                prompt = "Continue where you left off, using MEMORY above for context.";
                firstIteration = true;
            }

            const stopAfterToolCall = this.#allowedTools.filter(t => nativeCalls.map(nc => nc.name).includes(t.getOptions().name)).find(t => t.getOptions().stopIterationAfterUsingThisTool)


            keepGoing = !stopAfterToolCall && calledAnyTool || memorizeEventHappened;


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
        };
    }
    getTotalTokens() {
        return {
            total: this.#currentInputHitTokens + this.#currentInputMissTokens + this.#currentOutputTokens + this.#fullInputHitTokens + this.#fullInputMissTokens + this.#fullOutputTokens,
            inputHit: this.#currentInputHitTokens + this.#fullInputHitTokens,
            inputMiss: this.#currentInputMissTokens + this.#fullInputMissTokens,
            output: this.#currentOutputTokens + this.#fullOutputTokens
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