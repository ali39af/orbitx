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

export class AnthropicProvider extends AIProvider {
    private client: Anthropic;
    private model: string;
    private supportsTools: boolean;
    private supportsImages: boolean;
    private contextWindow: number;
    private maxTokens: number;

    constructor(apiKey: string, model: string = "claude-sonnet-5", options: { supportsTools?: boolean; supportsImages?: boolean; contextWindow?: number; maxTokens?: number } = {}) {
        super();
        this.client = new Anthropic({ apiKey });
        this.model = model;
        this.supportsTools = options.supportsTools ?? true;
        this.supportsImages = options.supportsImages ?? true;
        this.contextWindow = options.contextWindow ?? MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
        this.maxTokens = options.maxTokens ?? 4096;
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
        const { system, messages: formattedMessages } = toAnthropicMessages(messages);
        const formattedTools = tools && tools.length > 0 && this.supportsTools
            ? toAnthropicTools(tools)
            : undefined;

        if (streamCallback) {
            return withRetry(async () => {
                // Per-attempt accumulators live inside this closure so a
                // failed/partial stream from a previous attempt never leaks
                // into a retry's output — each attempt starts clean.
                const stream = await this.client.messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    ...(system ? { system } : {}),
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
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

                for await (const event of stream as any) {
                    if (event.type === "content_block_start") {
                        if (event.content_block?.type === "tool_use") {
                            toolBlocks[event.index] = {
                                id: event.content_block.id,
                                name: event.content_block.name,
                                inputJson: "",
                            };
                        }
                    }

                    if (event.type === "content_block_delta") {
                        if (event.delta?.type === "text_delta" && event.delta.text) {
                            fullContent += event.delta.text;
                            streamCallback({ role: "assistant", content: event.delta.text, done: false });
                        }
                        if (event.delta?.type === "input_json_delta" && toolBlocks[event.index]) {
                            toolBlocks[event.index].inputJson += event.delta.partial_json || "";
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
                const response = await this.client.messages.create({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    ...(system ? { system } : {}),
                    messages: formattedMessages as any,
                    ...(formattedTools ? { tools: formattedTools } : {}),
                });

                const toolCalls = fromAnthropicToolCalls(response.content as any);

                return {
                    content: textFromAnthropicContent(response.content as any),
                    inputTokens: response.usage?.input_tokens || 0,
                    outputTokens: response.usage?.output_tokens || 0,
                    ...(toolCalls ? { toolCalls } : {}),
                };
            });
        }
    }
}

export default AnthropicProvider;