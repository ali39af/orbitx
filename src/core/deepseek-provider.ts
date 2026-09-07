import OpenAI from "openai";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";
import { resolveThinkEffortLevel, type ThinkEffortLevel } from "./think-effort.js";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    "deepseek-v4-flash": 1_000_000,
    "deepseek-v4-flash-vision-exp": 1_000_000,
    "deepseek-v4-pro": 1_000_000,
};
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** Uniform across every DeepSeek model — see ProviderCapabilities.maxOutputTokens. */
const MAX_OUTPUT_TOKENS = 384_000;

// DeepSeek's reasoning models accept `reasoning_effort` as one of these
// four levels (OpenAI-compatible param, not in the `openai` SDK's types).
const DEEPSEEK_THINK_LEVELS: readonly ThinkEffortLevel[] = ["none", "low", "high", "max"];

const IMAGE_MODELS = new Set(["deepseek-v4-flash-vision-exp"]);

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

export class DeepSeekProvider extends AIProvider {
    #client: OpenAI;
    #model: string;
    #supportsTools: boolean;
    #supportsImages: boolean;
    #contextWindow: number;
    /** Universal 0-1 thinking effort — see src/core/think-effort.ts. Mapped onto DEEPSEEK_THINK_LEVELS in #chat. */
    #thinkEffort?: number;
    /** Opaque end-user identifier forwarded as `user_id` on every request — see docs/providers.md#user-tracking. */
    #userId?: string;

    constructor(apiKey: string, model: string = "deepseek-v4-flash", options: { supportsTools?: boolean; supportsImages?: boolean; contextWindow?: number; thinkEffort?: number; userId?: string } = {}) {
        super();
        this.#client = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.deepseek.com"
        });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? true;
        this.#supportsImages = options.supportsImages ?? IMAGE_MODELS.has(model);
        this.#contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
        this.#thinkEffort = options.thinkEffort;
        this.#userId = options.userId;
    }

    getModel(): string {
        return this.#model;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: this.#supportsImages,
            contextWindow: this.#contextWindow,
            safeUsageRatio: 0.7,
            supportsThinking: true,
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
            default: throw new Error(`DeepSeekProvider does not support setting option "${key}"`);
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
        const thinkLevel = resolveThinkEffortLevel(this.#thinkEffort, DEEPSEEK_THINK_LEVELS);
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

            let inputMissTokens = 0;
            let inputCacheTokens = 0;
            let outputTokens = 0;

            let fullContent = "";
            let fullThinking = "";
            const toolCallChunks: Record<number, { id?: string; name?: string; arguments: string }> = {};
            // See the identical comment in openai-provider.ts: DeepSeek's
            // Chat-Completions-compatible stream has no explicit
            // "this tool call is done" event, so completion is inferred
            // from the next call's id starting to arrive (or the stream
            // ending, for the last/only call).
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

                    // DeepSeek's reasoner models stream reasoning text on
                    // `delta.reasoning_content`, separately from `content`.
                    const reasoning = delta?.reasoning_content || "";
                    if (reasoning) {
                        fullThinking += reasoning;
                        await streamCallback({ role: "assistant", content: "", done: false, thinking: reasoning, usage: { inputMissTokens: 0, inputCacheTokens: 0, outputTokens: 0 } });
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
                        const usage = chunk.usage as any;
                        const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
                        inputCacheTokens = usage.prompt_cache_hit_tokens ?? cachedTokens;
                        inputMissTokens = usage.prompt_cache_miss_tokens ?? ((usage.prompt_tokens || 0) - inputCacheTokens);
                        outputTokens = usage.completion_tokens || 0;
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

            await streamCallback({
                role: "assistant", content: "", done: true,
                usage: { inputMissTokens, inputCacheTokens, outputTokens },
            });

            return {
                content: fullContent,
                inputMissTokens,
                inputCacheTokens,
                outputTokens,
                ...(toolCalls ? { toolCalls } : {}),
                ...(fullThinking ? { thinking: fullThinking } : {}),
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

        const message = response.choices[0]?.message as any;
        const usage = response.usage as any;
        const inputCacheTokens = usage?.prompt_cache_hit_tokens ?? 0;
        const inputMissTokens = usage?.prompt_cache_miss_tokens ?? ((usage?.prompt_tokens || 0) - inputCacheTokens);

        return {
            content: message?.content || "",
            inputMissTokens,
            inputCacheTokens,
            outputTokens: response.usage?.completion_tokens || 0,
            ...(fromOpenAIToolCalls(message?.tool_calls as any) ? { toolCalls: fromOpenAIToolCalls(message?.tool_calls as any) } : {}),
            ...(message?.reasoning_content ? { thinking: message.reasoning_content } : {}),
        };
    }, signal);
}
    }
}

export default DeepSeekProvider;