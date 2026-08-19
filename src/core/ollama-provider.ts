import { Ollama } from "ollama";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";
import { resolveThinkEffortLevel, type ThinkEffortLevel } from "./think-effort.js";

const DEFAULT_CONTEXT_WINDOW = 32_000;

// Ollama's `think` option accepts a boolean (most thinking-capable models,
// e.g. deepseek-r1/qwen3) or, for a smaller set of newer models (e.g.
// gpt-oss), one of these three levels. thinkEffort === 0 maps to `false`
// (thinking off) rather than the lowest level, so it still works as an
// on/off switch for models that only understand booleans.
const OLLAMA_THINK_LEVELS: readonly ThinkEffortLevel[] = ["low", "medium", "high"];

function toOllamaMessages(messages: Message[], supportsTools: boolean): any[] {
    return messages.map(msg => {
        // Ollama rejects `tool`-role messages for models that don't support
        // tool-calling at all (it throws). BaseAgent only builds tool-role
        // messages when it already knows supportsTools is true, so this is
        // just a defensive downgrade in case a `tool` message ever reaches
        // here on a non-tool-capable model — fold it into `system` instead
        // of letting the API error out.
        if (msg.role === "tool" && !supportsTools) {
            return { role: "system", content: msg.content || "" };
        }

        if (msg.role === "tool") {
            return {
                role: "tool",
                content: msg.content || "",
                tool_name: msg.toolName,
            };
        }

        if (msg.role === "assistant" && msg.toolCalls?.length && supportsTools) {
            return {
                role: "assistant",
                content: msg.content || "",
                tool_calls: msg.toolCalls.map(tc => ({
                    function: { name: tc.name, arguments: tc.inputs },
                })),
            };
        }

        if (msg.parts?.length) {
            const text = msg.parts.filter(p => p.type === "text").map(p => (p as any).text).join("\n");
            const images = msg.parts.filter(p => p.type === "image").map(p => (p as any).image);
            return { role: msg.role, content: text, ...(images.length ? { images } : {}) };
        }

        return { role: msg.role, content: msg.content || "" };
    });
}

function fromOllamaToolCalls(toolCalls: any[] | undefined): ToolCallRequest[] | undefined {
    if (!toolCalls || toolCalls.length === 0) return undefined;
    return toolCalls.map((tc: any, idx: number) => ({
        id: `${idx}`,
        name: tc.function?.name || "",
        inputs: tc.function?.arguments || {},
    }));
}

export class OllamaProvider extends AIProvider {
    #client: Ollama;
    #model: string;
    // Whether the currently-configured model supports Ollama's native
    // function-calling API. Ollama throws if `tools` is sent to a model
    // that doesn't support it, so this must be known ahead of time rather
    // than discovered by trial and error — callers should set this based on
    // the model card (most recent tool-capable families default to true).
    #supportsTools: boolean;
    #contextWindow: number;
    /** Universal 0-1 thinking effort — see src/core/think-effort.ts. Mapped onto a boolean or OLLAMA_THINK_LEVELS in #chat; ignored by models that don't support thinking (Ollama itself ignores an unrecognized `think` value rather than erroring). */
    #thinkEffort?: number;

    constructor(model: string, host: string = "http://localhost:11434", options: { supportsTools?: boolean; contextWindow?: number; thinkEffort?: number } = {}) {
        super();
        this.#client = new Ollama({ host });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? false;
        this.#contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        this.#thinkEffort = options.thinkEffort;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: true,
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
        const formattedMessages = toOllamaMessages(messages, this.#supportsTools);
        // Never send `tools` to a model we don't know supports it — Ollama
        // throws rather than silently ignoring an unsupported `tools` field.
        const formattedTools = tools && tools.length > 0 && this.#supportsTools
            ? toOpenAIFunctionTools(tools)
            : undefined;
        // OLLAMA_THINK_LEVELS only contains "low"/"medium"/"high", so this
        // narrows to what Ollama's own `think` type actually accepts.
        const think = this.#thinkEffort === undefined
            ? undefined
            : this.#thinkEffort <= 0
                ? false
                : resolveThinkEffortLevel(this.#thinkEffort, OLLAMA_THINK_LEVELS) as "low" | "medium" | "high";
        const thinkParam = think !== undefined ? { think } : {};

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.#client.chat({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkParam,
                    stream: true
                });

                let fullContent = "";
                let fullThinking = "";
                let promptEvalCount = 0;
                let evalCount = 0;
                let toolCalls: ToolCallRequest[] | undefined;
                const emittedToolCallIds = new Set<string>();

                for await (const chunk of stream) {
                    const content = chunk.message?.content || "";
                    if (content) {
                        fullContent += content;
                        await streamCallback({ role: "assistant", content, done: false });
                    }

                    // Thinking-capable models stream reasoning text on
                    // `message.thinking`, separately from `message.content`.
                    const thinking = (chunk.message as any)?.thinking || "";
                    if (thinking) {
                        fullThinking += thinking;
                        await streamCallback({ role: "assistant", content: "", done: false, thinking });
                    }

                    if (chunk.message?.tool_calls?.length) {
                        // Unlike OpenAI/DeepSeek/Anthropic, Ollama doesn't
                        // stream a tool call's arguments incrementally — each
                        // one arrives already fully formed, so it can be
                        // emitted the moment it's seen instead of waiting
                        // for the response to finish.
                        toolCalls = fromOllamaToolCalls(chunk.message.tool_calls as any);
                        for (const toolCall of toolCalls ?? []) {
                            if (emittedToolCallIds.has(toolCall.id)) continue;
                            emittedToolCallIds.add(toolCall.id);
                            await streamCallback({ role: "assistant", content: "", done: false, toolCalls: [toolCall] });
                        }
                    }

                    if (chunk.prompt_eval_count !== undefined) {
                        promptEvalCount = chunk.prompt_eval_count;
                    }
                    if (chunk.eval_count !== undefined) {
                        evalCount = chunk.eval_count;
                    }
                }

                await streamCallback({ role: "assistant", content: "", done: true });
                return {
                    content: fullContent,
                    inputTokens: promptEvalCount,
                    outputTokens: evalCount,
                    ...(toolCalls ? { toolCalls } : {}),
                    ...(fullThinking ? { thinking: fullThinking } : {}),
                };
            });
        } else {
            return withRetry(async () => {
                const response = await this.#client.chat({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkParam,
                });

                const thinking = (response.message as any)?.thinking;

                return {
                    content: response.message?.content || "",
                    inputTokens: response.prompt_eval_count || 0,
                    outputTokens: response.eval_count || 0,
                    ...(fromOllamaToolCalls(response.message?.tool_calls as any) ? { toolCalls: fromOllamaToolCalls(response.message?.tool_calls as any) } : {}),
                    ...(thinking ? { thinking } : {}),
                };
            });
        }
    }
}

export default OllamaProvider;
