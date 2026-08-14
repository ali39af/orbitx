/**
 * Standard, provider-agnostic tool schema. Every AIProvider is responsible
 * for translating this into whatever shape its own API expects (OpenAI-style
 * `tools: [{type:"function", function:{...}}]`, Ollama's function-calling
 * format, etc.) — the rest of the codebase (BaseAgent, MCPClient) never needs
 * to know about a specific provider's wire format.
 */
export interface ToolSchema {
    name: string;
    description: string;
    inputs: {
        name: string;
        type: "number" | "string" | "boolean" | "object" | "array";
        description: string;
        required?: boolean;
        default?: any;
    }[];
}

/** A tool call the model asked to make, normalized across providers. */
export interface ToolCallRequest {
    id: string;
    name: string;
    inputs: Record<string, any>;
}

/** A single piece of message content: plain text, or an image for multimodal providers. */
export type MessageContentPart =
    | { type: "text"; text: string }
    | { type: "image"; image: string /* base64, no data: prefix required */; mimeType?: string };

export interface Message {
    role: "user" | "system" | "assistant" | "tool";
    content?: string;
    /** Optional richer content (e.g. images) for providers that support multimodal input. If present, takes precedence over `content` for those providers; providers without image support should fall back to `content`/a text-only projection. */
    parts?: MessageContentPart[];
    /** Present on assistant messages that requested native tool calls. */
    toolCalls?: ToolCallRequest[];
    /** Present on tool-role messages responding to a native tool call. */
    toolCallId?: string;
    /** Present on tool-role messages responding to a native tool call — the tool name being answered. */
    toolName?: string;
}

export interface ChatResponse {
    content: string;
    inputTokens: number;
    outputTokens: number;
    /** Native tool calls requested by the model, when the provider supports native tool-calling and tools were supplied. */
    toolCalls?: ToolCallRequest[];
}

export type StreamCallback = (chunk: {
    role: "assistant" | "tool" | "user";
    content: string;
    done: boolean;
    /** Present on the final ("done") assistant chunk when the model requested native tool calls this turn. */
    toolCalls?: ToolCallRequest[];
    /** Present on "tool"-role chunks — the id of the native tool call this result answers. */
    toolCallId?: string;
    /** Present on "tool"-role chunks — the name of the tool that was called. */
    toolName?: string;
}) => Promise<void> | void;

/**
 * Static capability + limits description for a provider/model pair. This
 * lets callers (BaseAgent in particular) make decisions — like whether to
 * rely on native tool-calling vs. the legacy JSON-in-text convention, or
 * where to trigger a memory-compaction pass — based on what the provider
 * actually supports, instead of a single hardcoded constant.
 */
export interface ProviderCapabilities {
    /** Whether this provider/model can receive a `tools` schema and return native tool_calls. When false, BaseAgent falls back to legacy JSON-in-text tool calls carried over `system`-role messages. */
    supportsTools: boolean;
    /** Whether this provider/model accepts image content in messages. */
    supportsImages: boolean;
    /** The model's total context window, in tokens. Used to derive a safe default for when to trigger a memory-compaction event, without needing a hardcoded per-agent constant. */
    contextWindow: number;
    /** Fraction of the context window (0-1) that's safe to fill before compacting; leaves headroom for the system prompt, tool schema, and the model's own output. Defaults applied by callers if not specified. */
    safeUsageRatio?: number;
}

export abstract class AIProvider {
    abstract chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        tools?: ToolSchema[]
    ): Promise<ChatResponse>;

    /** Describe what this provider/model can do — used by BaseAgent to pick the native-tools vs. legacy-JSON path and to size the memory-compaction threshold. */
    abstract getCapabilities(): ProviderCapabilities;
}

export default AIProvider;
