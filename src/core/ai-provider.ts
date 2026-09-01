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

export type ProviderType =
    | "main"
    | "image-describer"
    | "image-generation"
    | "image-editing"
    | "video-describer"
    | "video-generation"
    | "video-editing"
    | "audio-describer"
    | "audio-generation"
    | "audio-design"
    | "audio-clone"
    | "3d-model-generator"
    | "llm-low"
    | "llm-medium"
    | "llm-high"
    | (string & {});

export interface MessageUsageTokens {
    type: ProviderType;
    unit: "tokens";
    inputMissTokens: number;
    inputCacheTokens: number;
    outputTokens: number;
}

export interface MessageUsageCost {
    type: ProviderType;
    unit: "cost";
    cost: number;
}

export type MessageUsage = MessageUsageTokens | MessageUsageCost;

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
    timestamp?: number;
    /** True on messages BaseAgent injects itself rather than ones a human or the model produced (e.g. the forced-compaction nudge) — a hint for UI code to filter out of what's shown to an end user. Defaults to false/absent; purely a display hint, not sent to any provider. */
    hidden?: boolean;
    usage?: MessageUsage[];
}

export interface ChatResponse {
    content: string;
    inputMissTokens?: number;
    inputCacheTokens?: number;
    outputTokens?: number;
    cost?: number;
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
    /**
     * A tool call the model requested this turn. Emitted incrementally, as
     * a single-element array, the moment *that one call* finishes
     * generating — mid-stream, before the rest of the turn (more tool
     * calls, or trailing text) has necessarily finished. Purely
     * observational: it lets a consumer show "the model decided to call X"
     * as it happens. It does not affect when the call is actually
     * dispatched — `BaseAgent` still waits for the whole turn to finish and
     * dispatches from `ChatResponse.toolCalls` (the full, aggregated list),
     * regardless of what streamed through here. Not resent on the final
     * `done: true` chunk — every call was already streamed individually by
     * the time that chunk arrives, so it would just be a duplicate.
     */
    toolCalls?: ToolCallRequest[];
    /** Present on "tool"-role chunks — the id of the native tool call this result answers. */
    toolCallId?: string;
    /** Present on "tool"-role chunks — the name of the tool that was called. */
    toolName?: string;
    /** Reasoning/thinking text delta for this chunk, mirroring `content` — present only while the model is thinking, absent (or empty) once it moves on to its actual answer. Only ever set on non-`done` assistant chunks. Never set unless the provider was configured with `thinkEffort` and can stream thinking (see `ProviderCapabilities.supportsThinking`); when a thinking chunk is emitted, `content` on that same chunk is empty. */
    thinking?: string;
    /** Mirrors `Message.hidden` — true on chunks for a message BaseAgent injected itself (e.g. the forced-compaction nudge), so a live-streaming UI can filter it out the same way it would filter the persisted Message. */
    hidden?: boolean;
    usage?: {
        inputMissTokens: number;
        inputCacheTokens: number;
        outputTokens: number;
    };
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
    /** The model's maximum output tokens per response, when known. Not yet enforced anywhere — reserved for the agent loop to size/guard its own output budgeting in a future release. Undefined where not confirmed for a given provider/model. */
    maxOutputTokens?: number;
    /** Fraction of the context window (0-1) that's safe to fill before compacting; leaves headroom for the system prompt, tool schema, and the model's own output. Defaults applied by callers if not specified. */
    safeUsageRatio?: number;
    /** Whether this provider can surface the model's reasoning/thinking text (streamed via the `thinking` chunk field, and returned as `ChatResponse.thinking`) when constructed with `thinkEffort`. A provider may still accept/honor `thinkEffort` server-side (e.g. it changes response quality/latency) while reporting `false` here, if its API never exposes the reasoning text itself. */
    supportsThinking?: boolean;
    /** Whether this provider/model accepts video content in messages. */
    supportsVideo?: boolean;
    /** Whether this provider/model accepts audio content in messages. */
    supportsAudio?: boolean;
    /** Whether this provider/model can generate new images. */
    supportsImageGeneration?: boolean;
    /** Whether this provider/model can edit an existing image. */
    supportsImageEditing?: boolean;
    /** Whether this provider/model can generate new video. */
    supportsVideoGeneration?: boolean;
    /** Whether this provider/model can edit existing video. */
    supportsVideoEditing?: boolean;
    /** Whether this provider/model can generate new audio (speech, music, sound effects). */
    supportsAudioGeneration?: boolean;
    /** Whether this provider/model can design/produce sound effects or soundscapes. */
    supportsAudioDesign?: boolean;
    /** Whether this provider/model can clone a voice from a reference sample. */
    supportsAudioClone?: boolean;
    /** Whether this provider/model can generate a new 3D model. */
    supports3DModelGeneration?: boolean;
}

export abstract class AIProvider {
    /**
     * @param signal When provided and later aborted, the in-flight request to the underlying
     * provider API is cancelled immediately (not just abandoned client-side) — used by
     * `BaseAgent.immediateStop()` to cut off a call's cost/token usage right away instead of
     * waiting for it to finish. Providers built on fetch-based SDKs (Anthropic, OpenAI,
     * DeepSeek) honor this for both streaming and non-streaming calls; Ollama's client only
     * supports it for streaming calls (see ollama-provider.ts).
     */
    abstract chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        tools?: ToolSchema[],
        signal?: AbortSignal
    ): Promise<ChatResponse>;

    /** Describe what this provider/model can do — used by BaseAgent to pick the native-tools vs. legacy-JSON path and to size the memory-compaction threshold. */
    abstract getCapabilities(): ProviderCapabilities;

    abstract setOption(key: string, value: unknown): void;
}

export default AIProvider;
