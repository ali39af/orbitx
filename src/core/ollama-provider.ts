import { Ollama } from "ollama";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";

const DEFAULT_CONTEXT_WINDOW = 32_000;

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

    constructor(model: string, host: string = "http://localhost:11434", options: { supportsTools?: boolean; contextWindow?: number } = {}) {
        super();
        this.#client = new Ollama({ host });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? false;
        this.#contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: true,
            contextWindow: this.#contextWindow,
            safeUsageRatio: 0.5,
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

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.#client.chat({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    stream: true
                });

                let fullContent = "";
                let promptEvalCount = 0;
                let evalCount = 0;
                let toolCalls: ToolCallRequest[] | undefined;

                for await (const chunk of stream) {
                    const content = chunk.message?.content || "";
                    if (content) {
                        fullContent += content;
                        await streamCallback({ role: "assistant", content, done: false });
                    }

                    if (chunk.message?.tool_calls?.length) {
                        toolCalls = fromOllamaToolCalls(chunk.message.tool_calls as any);
                    }

                    if (chunk.prompt_eval_count !== undefined) {
                        promptEvalCount = chunk.prompt_eval_count;
                    }
                    if (chunk.eval_count !== undefined) {
                        evalCount = chunk.eval_count;
                    }
                }

                await streamCallback({ role: "assistant", content: "", done: true, ...(toolCalls ? { toolCalls } : {}) });
                return {
                    content: fullContent,
                    inputTokens: promptEvalCount,
                    outputTokens: evalCount,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            });
        } else {
            return withRetry(async () => {
                const response = await this.#client.chat({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                });

                return {
                    content: response.message?.content || "",
                    inputTokens: response.prompt_eval_count || 0,
                    outputTokens: response.eval_count || 0,
                    ...(fromOllamaToolCalls(response.message?.tool_calls as any) ? { toolCalls: fromOllamaToolCalls(response.message?.tool_calls as any) } : {}),
                };
            });
        }
    }
}

export default OllamaProvider;
