import Anthropic from "@anthropic-ai/sdk";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toAnthropicTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    "claude-opus-4-8": 200_000,
    "claude-sonnet-5": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
    "claude-fable-5": 200_000,
    "claude-mythos-5": 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

// Anthropic's extended thinking takes a numeric token budget rather than a
// low/medium/high enum, so the universal 0-1 `thinkEffort` is mapped onto a
// budget range instead of going through resolveThinkEffortLevel(). The
// range scales off the configured `maxTokens` so a bigger output budget
// also buys a bigger thinking budget at the same effort value.
const MIN_THINKING_BUDGET_TOKENS = 1024;

function resolveThinkingBudget(effort: number, baseMaxTokens: number): number {
    const clamped = Math.max(0, Math.min(1, effort));
    const ceiling = Math.max(MIN_THINKING_BUDGET_TOKENS, baseMaxTokens * 4);
    return Math.round(MIN_THINKING_BUDGET_TOKENS + clamped * (ceiling - MIN_THINKING_BUDGET_TOKENS));
}

/**
 * Anthropic keeps `system` out of the messages array entirely, and encodes
 * tool calls/results as content blocks (`tool_use` on assistant turns,
 * `tool_result` inside a user turn) rather than dedicated message roles.
 * This walks the provider-agnostic Message[] and produces both the
 * extracted system string and the Anthropic-shaped message array.
 */
function toAnthropicMessages(messages: Message[]): { system: string; messages: any[] } {
    const systemParts: string[] = [];
    const out: any[] = [];

    for (const msg of messages) {
        if (msg.role === "system") {
            if (msg.content) systemParts.push(msg.content);
            continue;
        }

        if (msg.role === "tool") {
            // Anthropic expects tool results as a user message containing a
            // tool_result block; merge into the previous user message if it
            // was itself a tool-result carrier, otherwise start a new one.
            out.push({
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: msg.toolCallId,
                        content: msg.content || "",
                    },
                ],
            });
            continue;
        }

        if (msg.role === "assistant" && msg.toolCalls?.length) {
            const content: any[] = [];
            // Extended thinking requires the signed thinking block(s) from
            // this exact turn to be replayed before the tool_use blocks on
            // any subsequent request that includes it — otherwise the API
            // rejects the request. See Message.providerThinking.
            if (msg.providerThinking?.length) content.push(...msg.providerThinking);
            if (msg.content) content.push({ type: "text", text: msg.content });
            for (const tc of msg.toolCalls) {
                content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.inputs });
            }
            out.push({ role: "assistant", content });
            continue;
        }

        if (msg.parts?.length) {
            out.push({
                role: msg.role,
                content: msg.parts.map(p => p.type === "text"
                    ? { type: "text", text: p.text }
                    : { type: "image", source: { type: "base64", media_type: p.mimeType || "image/png", data: p.image } }),
            });
            continue;
        }

        out.push({ role: msg.role, content: msg.content || "" });
    }

    return { system: systemParts.join("\n\n"), messages: out };
}

function fromAnthropicToolCalls(content: any[] | undefined): ToolCallRequest[] | undefined {
    if (!content) return undefined;
    const toolUses = content.filter((block: any) => block.type === "tool_use");
    if (toolUses.length === 0) return undefined;
    return toolUses.map((block: any) => ({
        id: block.id,
        name: block.name,
        inputs: block.input || {},
    }));
}

function textFromAnthropicContent(content: any[] | undefined): string {
    if (!content) return "";
    return content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
}

/** Extract raw thinking blocks (to carry forward via Message.providerThinking) and their concatenated text, from a non-streaming response's content array. */
function thinkingFromAnthropicContent(content: any[] | undefined): { text: string; blocks?: any[] } {
    if (!content) return { text: "" };
    const blocks = content.filter((block: any) => block.type === "thinking" || block.type === "redacted_thinking");
    if (blocks.length === 0) return { text: "" };
    return {
        text: blocks.map((b: any) => b.thinking || "").join(""),
        blocks,
    };
}

export class AnthropicProvider extends AIProvider {
    #client: Anthropic;
    #model: string;
    #supportsTools: boolean;
    #supportsImages: boolean;
    #contextWindow: number;
    #maxTokens: number;
    /** Universal 0-1 thinking effort — see src/core/think-effort.ts. Mapped onto Anthropic's numeric thinking-token budget in #chat. */
    #thinkEffort?: number;

    constructor(apiKey: string, model: string = "claude-sonnet-5", options: { supportsTools?: boolean; supportsImages?: boolean; contextWindow?: number; maxTokens?: number; thinkEffort?: number } = {}) {
        super();
        this.#client = new Anthropic({ apiKey });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? true;
        this.#supportsImages = options.supportsImages ?? true;
        this.#contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
        this.#maxTokens = options.maxTokens ?? 4096;
        this.#thinkEffort = options.thinkEffort;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: this.#supportsImages,
            contextWindow: this.#contextWindow,
            safeUsageRatio: 0.5,
            supportsThinking: true,
        };
    }

    async chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        tools?: ToolSchema[]
    ): Promise<ChatResponse> {
        const { system, messages: formattedMessages } = toAnthropicMessages(messages);
        const formattedTools = tools && tools.length > 0 && this.#supportsTools
            ? toAnthropicTools(tools)
            : undefined;

        const thinkingBudget = this.#thinkEffort !== undefined
            ? resolveThinkingBudget(this.#thinkEffort, this.#maxTokens)
            : undefined;
        // max_tokens must exceed the thinking budget, so it's added on top
        // of the configured output budget rather than eating into it.
        const effectiveMaxTokens = thinkingBudget !== undefined ? this.#maxTokens + thinkingBudget : this.#maxTokens;
        const thinkingParam = thinkingBudget !== undefined
            ? { thinking: { type: "enabled" as const, budget_tokens: thinkingBudget } }
            : {};

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.#client.messages.create({
                    model: this.#model,
                    max_tokens: effectiveMaxTokens,
                    ...(system ? { system } : {}),
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkingParam,
                    stream: true,
                });

                let fullContent = "";
                let inputTokens = 0;
                let outputTokens = 0;
                // Anthropic streams tool_use blocks as a start event (with
                // id/name) followed by incremental input_json_delta chunks,
                // so the partial JSON has to be accumulated per block index
                // the same way OpenAI's function-call arguments are.
                const toolBlocks: Record<number, { id?: string; name?: string; inputJson: string }> = {};
                // Thinking blocks stream the same way: a start event, then
                // incremental thinking_delta (text) and signature_delta
                // (the cryptographic signature Anthropic requires replayed
                // verbatim alongside a tool_use in the same turn).
                const thinkingBlocks: Record<number, { type: "thinking"; thinking: string; signature: string }> = {};

                for await (const event of stream as any) {
                    if (event.type === "content_block_start") {
                        if (event.content_block?.type === "tool_use") {
                            toolBlocks[event.index] = {
                                id: event.content_block.id,
                                name: event.content_block.name,
                                inputJson: "",
                            };
                        }
                        if (event.content_block?.type === "thinking") {
                            thinkingBlocks[event.index] = { type: "thinking", thinking: "", signature: "" };
                        }
                    }

                    if (event.type === "content_block_delta") {
                        if (event.delta?.type === "text_delta" && event.delta.text) {
                            fullContent += event.delta.text;
                            await streamCallback({ role: "assistant", content: event.delta.text, done: false });
                        }
                        if (event.delta?.type === "input_json_delta" && toolBlocks[event.index]) {
                            toolBlocks[event.index].inputJson += event.delta.partial_json || "";
                        }
                        if (event.delta?.type === "thinking_delta" && thinkingBlocks[event.index]) {
                            thinkingBlocks[event.index].thinking += event.delta.thinking || "";
                            await streamCallback({ role: "assistant", content: "", done: false, thinking: event.delta.thinking || "" });
                        }
                        if (event.delta?.type === "signature_delta" && thinkingBlocks[event.index]) {
                            thinkingBlocks[event.index].signature += event.delta.signature || "";
                        }
                    }

                    if (event.type === "message_start") {
                        inputTokens = event.message?.usage?.input_tokens || 0;
                    }

                    if (event.type === "message_delta") {
                        if (event.usage?.output_tokens !== undefined) {
                            outputTokens = event.usage.output_tokens;
                        }
                    }
                }

                const toolCalls: ToolCallRequest[] | undefined = Object.keys(toolBlocks).length > 0
                    ? Object.values(toolBlocks).map(tb => {
                        let inputs: Record<string, any> = {};
                        try { inputs = JSON.parse(tb.inputJson || "{}"); } catch { inputs = {}; }
                        return { id: tb.id || "", name: tb.name || "", inputs };
                    })
                    : undefined;

                const providerThinking = Object.keys(thinkingBlocks).length > 0 ? Object.values(thinkingBlocks) : undefined;
                const thinkingText = providerThinking?.map(b => b.thinking).join("");

                await streamCallback({ role: "assistant", content: "", done: true, ...(toolCalls ? { toolCalls } : {}) });

                return {
                    content: fullContent,
                    inputTokens,
                    outputTokens,
                    ...(toolCalls ? { toolCalls } : {}),
                    ...(thinkingText ? { thinking: thinkingText } : {}),
                    ...(providerThinking ? { providerThinking } : {}),
                };
            });
        } else {
            return withRetry(async () => {
                const response = await this.#client.messages.create({
                    model: this.#model,
                    max_tokens: effectiveMaxTokens,
                    ...(system ? { system } : {}),
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkingParam,
                });

                const toolCalls = fromAnthropicToolCalls(response.content as any);
                const { text: thinkingText, blocks: providerThinking } = thinkingFromAnthropicContent(response.content as any);

                return {
                    content: textFromAnthropicContent(response.content as any),
                    inputTokens: response.usage?.input_tokens || 0,
                    outputTokens: response.usage?.output_tokens || 0,
                    ...(toolCalls ? { toolCalls } : {}),
                    ...(thinkingText ? { thinking: thinkingText } : {}),
                    ...(providerThinking ? { providerThinking } : {}),
                };
            });
        }
    }
}

export default AnthropicProvider;