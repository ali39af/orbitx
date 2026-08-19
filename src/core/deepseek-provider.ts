import OpenAI from "openai";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";
import { resolveThinkEffortLevel, type ThinkEffortLevel } from "./think-effort.js";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    "deepseek-v4-flash": 1_000_000,
    "deepseek-v4-pro": 1_000_000,
};
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

// DeepSeek's reasoning models accept `reasoning_effort` as one of these
// four levels (OpenAI-compatible param, not in the `openai` SDK's types).
const DEEPSEEK_THINK_LEVELS: readonly ThinkEffortLevel[] = ["none", "low", "high", "max"];

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
    #contextWindow: number;
    /** Universal 0-1 thinking effort — see src/core/think-effort.ts. Mapped onto DEEPSEEK_THINK_LEVELS in #chat. */
    #thinkEffort?: number;

    constructor(apiKey: string, model: string = "deepseek-v4-flash", options: { supportsTools?: boolean; contextWindow?: number; thinkEffort?: number } = {}) {
        super();
        this.#client = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.deepseek.com"
        });
        this.#model = model;
        this.#supportsTools = options.supportsTools ?? true;
        this.#contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
        this.#thinkEffort = options.thinkEffort;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.#supportsTools,
            supportsImages: false,
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
        const formattedMessages = toOpenAIMessages(messages);
        const formattedTools = tools && tools.length > 0 && this.#supportsTools
            ? toOpenAIFunctionTools(tools)
            : undefined;
        const thinkLevel = resolveThinkEffortLevel(this.#thinkEffort, DEEPSEEK_THINK_LEVELS);
        const thinkParam = thinkLevel !== undefined ? { reasoning_effort: thinkLevel } : {};

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
                    stream: true
                });

                let fullContent = "";
                let fullThinking = "";
                let inputTokens = 0;
                let outputTokens = 0;
                const toolCallChunks: Record<number, { id?: string; name?: string; arguments: string }> = {};

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta as any;
                    const content = delta?.content || "";
                    if (content) {
                        fullContent += content;
                        await streamCallback({ role: "assistant", content, done: false });
                    }

                    // DeepSeek's reasoner models stream reasoning text on
                    // `delta.reasoning_content`, separately from `content`.
                    const reasoning = delta?.reasoning_content || "";
                    if (reasoning) {
                        fullThinking += reasoning;
                        await streamCallback({ role: "assistant", content: "", done: false, thinking: reasoning });
                    }

                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCallChunks[idx]) toolCallChunks[idx] = { arguments: "" };
                            if (tc.id) toolCallChunks[idx].id = tc.id;
                            if (tc.function?.name) toolCallChunks[idx].name = tc.function.name;
                            if (tc.function?.arguments) toolCallChunks[idx].arguments += tc.function.arguments;
                        }
                    }

                    if (chunk.usage) {
                        inputTokens = chunk.usage.prompt_tokens || 0;
                        outputTokens = chunk.usage.completion_tokens || 0;
                    }
                }

                const toolCalls: ToolCallRequest[] | undefined = Object.keys(toolCallChunks).length > 0
                    ? Object.values(toolCallChunks).map(tc => {
                        let inputs: Record<string, any> = {};
                        try { inputs = JSON.parse(tc.arguments || "{}"); } catch { inputs = {}; }
                        return { id: tc.id || "", name: tc.name || "", inputs };
                    })
                    : undefined;

                await streamCallback({ role: "assistant", content: "", done: true, ...(toolCalls ? { toolCalls } : {}) });

                return {
                    content: fullContent,
                    inputTokens,
                    outputTokens,
                    ...(toolCalls ? { toolCalls } : {}),
                    ...(fullThinking ? { thinking: fullThinking } : {}),
                };
            });
        } else {
            return withRetry(async () => {
                const response = await this.#client.chat.completions.create({
                    model: this.#model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    ...thinkParam,
                });

                const message = response.choices[0]?.message as any;

                return {
                    content: message?.content || "",
                    inputTokens: response.usage?.prompt_tokens || 0,
                    outputTokens: response.usage?.completion_tokens || 0,
                    ...(fromOpenAIToolCalls(message?.tool_calls as any) ? { toolCalls: fromOpenAIToolCalls(message?.tool_calls as any) } : {}),
                    ...(message?.reasoning_content ? { thinking: message.reasoning_content } : {}),
                };
            });
        }
    }
}

export default DeepSeekProvider;