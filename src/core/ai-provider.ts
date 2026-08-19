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
    /** Accumulated reasoning/thinking text the model produced before its final answer, when `thinkEffort` was set on the provider and it supports surfacing thinking (see `ProviderCapabilities.supportsThinking`). Informational only — not required to be resent to the provider. */
    thinking?: string;
    /**
     * Opaque, provider-specific thinking content (e.g. Anthropic's signed
     * `thinking` content blocks) that MUST be replayed verbatim on the next
     * turn for providers that validate it — needed when an assistant turn
     * mixed thinking with a native tool call. BaseAgent carries this through
     * untouched; only the provider that produced it interprets it.
     */
    providerThinking?: any[];
}

export interface ChatResponse {
    content: string;
    inputTokens: number;
    outputTokens: number;
    /** Native tool calls requested by the model, when the provider supports native tool-calling and tools were supplied. */
    toolCalls?: ToolCallRequest[];
    /** Accumulated reasoning/thinking text produced this turn, when thinking was requested and the provider can surface it. See `Message.thinking`. */
    thinking?: string;
    /** Opaque provider-specific thinking content to carry forward — see `Message.providerThinking`. */
    providerThinking?: any[];
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
    /** Reasoning/thinking text delta for this chunk, mirroring `content` — present only while the model is thinking, absent (or empty) once it moves on to its actual answer. Only ever set on non-`done` assistant chunks. Never set unless the provider was configured with `thinkEffort` and can stream thinking (see `ProviderCapabilities.supportsThinking`); when a thinking chunk is emitted, `content` on that same chunk is empty. */
    thinking?: string;
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
    /** Whether this provider can surface the model's reasoning/thinking text (streamed via the `thinking` chunk field, and returned as `ChatResponse.thinking`) when constructed with `thinkEffort`. A provider may still accept/honor `thinkEffort` server-side (e.g. it changes response quality/latency) while reporting `false` here, if its API never exposes the reasoning text itself. */
    supportsThinking?: boolean;
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
