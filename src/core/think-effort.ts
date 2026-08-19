/**
 * Every provider's native "how hard should the model think" knob uses a
 * different scale (OpenAI/Ollama: low/medium/high, DeepSeek: none/low/high/max,
 * Anthropic: a numeric thinking-token budget). OrbitX exposes a single
 * universal 0-1 float (`thinkEffort`) on every provider's constructor
 * options instead, and each provider maps it onto whatever scale it
 * actually accepts via this helper. Providers/models with no thinking
 * support at all simply ignore the option.
 */
export type ThinkEffortLevel = "none" | "low" | "medium" | "high" | "max";

/** Clamp an arbitrary number into the valid 0-1 think-effort range. */
export function clampThinkEffort(effort: number): number {
    return Math.max(0, Math.min(1, effort));
}

/**
 * Bucket a universal 0-1 think-effort value into one of a provider's
 * supported levels, evenly spaced so 0 always lands on `levels[0]` and 1
 * always lands on the last entry. Returns undefined when no effort was
 * requested, so callers can distinguish "not set" from "set to the lowest
 * level" and omit the native param entirely in the former case.
 */
export function resolveThinkEffortLevel(
    effort: number | undefined,
    levels: readonly ThinkEffortLevel[]
): ThinkEffortLevel | undefined {
    if (effort === undefined || levels.length === 0) return undefined;
    const clamped = clampThinkEffort(effort);
    const index = Math.round(clamped * (levels.length - 1));
    return levels[index];
}
