import OpenAI from "openai";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";
import { resolveThinkEffortLevel, type ThinkEffortLevel } from "./think-effort.js";

// Only OpenAI's reasoning-capable model families accept `reasoning_effort`
// at all — sending it to a non-reasoning model errors, so `thinkEffort` is
// silently ignored for anything outside this list. Chat Completions never
// exposes the reasoning text itself (unlike DeepSeek/Anthropic/Ollama), so
// there is no streamed `thinking` output for OpenAI even when this
// param is honored server-side.
const REASONING_MODEL_PREFIXES = ["o1", "o3", "o4", "gpt-5"];
const OPENAI_THINK_LEVELS: readonly ThinkEffortLevel[] = ["low", "medium", "high"];

function isReasoningModel(model: string): boolean {
    return REASONING_MODEL_PREFIXES.some(prefix => model.startsWith(prefix));
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    "gpt-5": 400_000,
    "gpt-5-mini": 400_000,
    "gpt-5-nano": 400_000,
    "gpt-5.6-sol": 1_050_000,
    "gpt-5.6-terra": 1_050_000,
    "gpt-5.6-luna": 1_050_000,
    "gpt-4.1": 1_047_576,
    "gpt-4.1-mini": 1_047_576,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "o3": 200_000,
    "o4-mini": 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Uniform across every OpenAI model — see ProviderCapabilities.maxOutputTokens. */
const MAX_OUTPUT_TOKENS = 128_000;

// Models whose Chat Completions image support is text-only / unsupported —
// kept as an explicit denylist so new models default to "supports images"
// rather than silently dropping multimodal input.
const NO_IMAGE_MODELS = new Set(["o3-mini", "o1-mini"]);

function toOpenAIMessages(messages: Message[]): any[] {
    return messages.map(msg => {
        if (msg.role === "tool") {
            return {
                role: "tool",
                content: msg.content || "",
                tool_call_id: msg.toolCallId,
            };
        }

        if (msg.role === "assistant" && msg.toolCalls?.length) {
            return {
                role: "assistant",
                content: msg.content || null,
                tool_calls: msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.inputs) },
                })),
            };
        }

        if (msg.parts?.length) {
            return {
                role: msg.role,
                content: msg.parts.map(p => p.type === "text"
                    ? { type: "text", text: p.text }
                    : { type: "image_url", image_url: { url: `data:${p.mimeType || "image/png"};base64,${p.image}` } }),
            };
        }

        return { role: msg.role, content: msg.content || "" };
    });
}

function fromOpenAIToolCalls(toolCalls: any[] | undefined): ToolCallRequest[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;
    return toolCalls
        .filter((tc: any) => tc.type === "function" || tc.function)
        .map((tc: any) => {
            let inputs: Record<string, any> = {};
            try {
                inputs = JSON.parse(tc.function.arguments || "{}");
            } catch {
                inputs = {};
            }
            return { id: tc.id, name: tc.function.name, inputs };
        });
}

export class OpenAIProvider extends AIProvider {
    #client: OpenAI;
    #model: string;
    #supportsTools: boolean;
    #supportsImages: boolean;
    #contextWindow: number;
    /** Universal 0-1 thinking effort — see src/core/think-effort.ts. Ignored unless the model is reasoning-capable (see isReasoningModel). */
    #thinkEffort?: number;
    /** Opaque end-user identifier forwarded as `user_id` on every request — see docs/providers.md#user-tracking. */
    #userId?: string;

    constructor(apiKey: string, model: string = "gpt-5", options: { supportsTools?: boolean; supportsImages?: boolean; contextWindow?: number; baseURL?: string; thinkEffort?: number; userId?: string } = {}) {
        super();
        this.#client = new OpenAI({
            apiKey: apiKey,
            ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? true;
        this.#supportsImages = options.supportsImages ?? !NO_IMAGE_MODELS.has(model);
        this.#contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
        this.#thinkEffort = options.thinkEffort;
        this.#userId = options.userId;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: this.#supportsImages,
            contextWindow: this.#contextWindow,
            safeUsageRatio: 0.7,
            supportsThinking: false,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            supportsVideo: false,
            supportsAudio: false,
            supportsImageGeneration: false,
            supportsImageEditing: false,
            supportsVideoGeneration: false,
            supportsVideoEditing: false,
            supportsAudioGeneration: false,
            supportsAudioDesign: false,
            supportsAudioClone: false,
            supports3DModelGeneration: false,
        };
    }

    /** Settable without reconstructing this provider: `thinkEffort`, `userId`, `supportsTools` — read fresh from the corresponding private field on every `chat()` call. */
    setOption(key: string, value: unknown): void {
        switch (key) {
            case "thinkEffort": this.#thinkEffort = value as number | undefined; return;
            case "userId": this.#userId = value as string | undefined; return;
            case "supportsTools": this.#supportsTools = value as boolean; return;
            default: throw new Error(`OpenAIProvider does not support setting option "${key}"`);
        }
    }

    async chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        tools?: ToolSchema[],
        signal?: AbortSignal
    ): Promise<ChatResponse> {
        const formattedMessages = toOpenAIMessages(messages);
        const formattedTools = tools && tools.length > 0 && this.#supportsTools
            ? toOpenAIFunctionTools(tools)
            : undefined;
        const thinkLevel = isReasoningModel(this.#model)
            ? resolveThinkEffortLevel(this.#thinkEffort, OPENAI_THINK_LEVELS)
            : undefined;
        const thinkParam = thinkLevel !== undefined ? { reasoning_effort: thinkLevel } : {};
        const userParam = this.#userId ? { metadata: { user_id: this.#userId } } as any : {};

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.#client.chat.completions.create({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkParam,
                    ...userParam,
                    stream: true,
                    stream_options: { include_usage: true },
                }, { signal }) as any;

                let fullContent = "";
                let inputMissTokens = 0;
                let inputCacheTokens = 0;
                let outputTokens = 0;
                const toolCallChunks: Record<number, { id?: string; name?: string; arguments: string }> = {};
                // OpenAI streams tool calls sequentially, one index at a
                // time, with no explicit "this call is done" event — the
                // only signal is the next call's first delta (carrying a
                // fresh `id`) starting to arrive. So: whenever a new index
                // shows up, the previously-active one must be finished;
                // finalize and emit it then. The very last call in the
                // response has no "next" index to trigger on, so it's
                // finalized after the loop ends instead.
                const emittedIndices = new Set<number>();
                const finalizedToolCalls: ToolCallRequest[] = [];
                let activeIndex: number | undefined;

                const finalizeAndEmit = async (idx: number) => {
                    if (emittedIndices.has(idx)) return;
                    emittedIndices.add(idx);
                    const tc = toolCallChunks[idx];
                    let inputs: Record<string, any> = {};
                    try { inputs = JSON.parse(tc.arguments || "{}"); } catch { inputs = {}; }
                    const finished = { id: tc.id || "", name: tc.name || "", inputs };
                    finalizedToolCalls.push(finished);
                    await streamCallback({ role: "assistant", content: "", done: false, toolCalls: [finished], usage: { inputMissTokens: 0, inputCacheTokens: 0, outputTokens: 0 } });
                };

                try {
                    for await (const chunk of stream) {
                        const delta = chunk.choices[0]?.delta as any;
                        const content = delta?.content || "";
                        if (content) {
                            fullContent += content;
                            await streamCallback({ role: "assistant", content, done: false, usage: { inputMissTokens: 0, inputCacheTokens: 0, outputTokens: 0 } });
                        }

                        if (delta?.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (tc.id && activeIndex !== undefined && activeIndex !== idx) {
                                    await finalizeAndEmit(activeIndex);
                                }
                                if (!toolCallChunks[idx]) toolCallChunks[idx] = { arguments: "" };
                                if (tc.id) toolCallChunks[idx].id = tc.id;
                                if (tc.function?.name) toolCallChunks[idx].name = tc.function.name;
                                if (tc.function?.arguments) toolCallChunks[idx].arguments += tc.function.arguments;
                                activeIndex = idx;
                            }
                        }

                        if (chunk.usage) {
                            const cachedTokens = (chunk.usage as any).prompt_tokens_details?.cached_tokens || 0;
                            inputCacheTokens = cachedTokens;
                            inputMissTokens = (chunk.usage.prompt_tokens || 0) - cachedTokens;
                            outputTokens = chunk.usage.completion_tokens || 0;
                        }
                    }
                } catch (err) {
                    if (!signal?.aborted) throw err;
                    activeIndex = undefined; // the stream cut off before we know this call finished — don't finalize it
                }
                if (activeIndex !== undefined) {
                    await finalizeAndEmit(activeIndex);
                }

                const toolCalls: ToolCallRequest[] | undefined = finalizedToolCalls.length > 0 ? finalizedToolCalls : undefined;

                await streamCallback({ role: "assistant", content: "", done: true, usage: { inputMissTokens, inputCacheTokens, outputTokens } });

                return {
                    content: fullContent,
                    inputMissTokens,
                    inputCacheTokens,
                    outputTokens,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            }, signal);
        } else {
            return withRetry(async () => {
                const response = await this.#client.chat.completions.create({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkParam,
                    ...userParam,
                }, { signal });

                const message = response.choices[0]?.message;
                const toolCalls = fromOpenAIToolCalls(message?.tool_calls as any);
                const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;

                return {
                    content: message?.content || "",
                    inputMissTokens: (response.usage?.prompt_tokens || 0) - cachedTokens,
                    inputCacheTokens: cachedTokens,
                    outputTokens: response.usage?.completion_tokens || 0,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            }, signal);
        }
    }
}

export default OpenAIProvider;