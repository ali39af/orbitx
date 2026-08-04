import OpenAI from "openai";
import type { Message, ChatResponse, StreamCallback, ToolSchema, ToolCallRequest, ProviderCapabilities } from "./ai-provider.js";
import AIProvider from "./ai-provider.js";
import { toOpenAIFunctionTools } from "./tool-schema-translator.js";
import { withRetry } from "./retry.js";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    "gpt-5": 400_000,
    "gpt-5-mini": 400_000,
    "gpt-5-nano": 400_000,
    "gpt-4.1": 1_047_576,
    "gpt-4.1-mini": 1_047_576,
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "o3": 200_000,
    "o4-mini": 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 128_000;

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
    private client: OpenAI;
    private model: string;
    private supportsTools: boolean;
    private supportsImages: boolean;
    private contextWindow: number;

    constructor(apiKey: string, model: string = "gpt-5", options: { supportsTools?: boolean; supportsImages?: boolean; contextWindow?: number; baseURL?: string } = {}) {
        super();
        this.client = new OpenAI({
            apiKey: apiKey,
            ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        });
        this.model = model;
        this.supportsTools = options.supportsTools ?? true;
        this.supportsImages = options.supportsImages ?? !NO_IMAGE_MODELS.has(model);
        this.contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTools: this.supportsTools,
            supportsImages: this.supportsImages,
            contextWindow: this.contextWindow,
            safeUsageRatio: 0.5,
        };
    }

    async chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        tools?: ToolSchema[]
    ): Promise<ChatResponse> {
        const formattedMessages = toOpenAIMessages(messages);
        const formattedTools = tools && tools.length > 0 && this.supportsTools
            ? toOpenAIFunctionTools(tools)
            : undefined;

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.client.chat.completions.create({
                    model: this.model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                    stream: true,
                    stream_options: { include_usage: true },
                });

                let fullContent = "";
                let inputTokens = 0;
                let outputTokens = 0;
                const toolCallChunks: Record<number, { id?: string; name?: string; arguments: string }> = {};

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta as any;
                    const content = delta?.content || "";
                    if (content) {
                        fullContent += content;
                        streamCallback({ role: "assistant", content, done: false });
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

                streamCallback({ role: "assistant", content: "", done: true, ...(toolCalls ? { toolCalls } : {}) });

                return {
                    content: fullContent,
                    inputTokens,
                    outputTokens,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            });
        } else {
            return withRetry(async () => {
                const response = await this.client.chat.completions.create({
                    model: this.model,
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                });

                const message = response.choices[0]?.message;
                const toolCalls = fromOpenAIToolCalls(message?.tool_calls as any);

                return {
                    content: message?.content || "",
                    inputTokens: response.usage?.prompt_tokens || 0,
                    outputTokens: response.usage?.completion_tokens || 0,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            });
        }
    }
}

export default OpenAIProvider;