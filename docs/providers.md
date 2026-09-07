# Providers

An `AIProvider` is OrbitX's abstraction over a model API. All four built-in providers implement the same interface (`src/core/ai-provider.ts`):

```ts
abstract class AIProvider {
  abstract chat(
    messages: Message[],
    streamCallback?: StreamCallback,
    tools?: ToolSchema[],
    signal?: AbortSignal
  ): Promise<ChatResponse>;

  abstract getModel(): string;

  abstract getCapabilities(): ProviderCapabilities;

  abstract setOption(key: string, value: unknown): void;
}
```

- `chat` sends the full message history (plus a provider-agnostic `tools` schema, when supplied) and returns a `ChatResponse` (`{ content, inputMissTokens, inputCacheTokens, outputTokens, toolCalls? }`) — `inputMissTokens`/`inputCacheTokens` are real, provider-reported non-cached/cache-hit input token counts (see "User tracking & prompt caching" below), not a client-side estimate. If `streamCallback` is passed, text is streamed to it incrementally as it arrives — see [Streaming](./streaming.md).
- `signal`, when passed and later aborted, cancels the in-flight request to the provider's API immediately rather than just abandoning it client-side — `BaseAgent.immediateStop()` uses this so the call stops generating (and billing for) further output right away. It doesn't retroactively waive input tokens or output already generated before the abort. Anthropic, OpenAI, and DeepSeek honor it for both streaming and non-streaming calls (their SDKs forward it straight to `fetch`). Ollama only honors it for streaming calls — its client has no way to abort a non-streaming request — so a `chat()` call made without a `streamCallback` against `OllamaProvider` can't be cancelled mid-flight; see the retry-loop guard in `ollama-provider.ts`.
  - **Streaming calls resolve normally on abort**, returning a `ChatResponse` built from whatever content/thinking/tool-calls were accumulated before the cutoff, instead of throwing — so text already delivered via `streamCallback` still ends up recorded rather than discarded. A tool call still being generated when the abort lands is dropped (its arguments may be truncated JSON); only tool calls that had already fully finished streaming are included in `toolCalls`.
  - **Non-streaming calls still throw on abort** — there's no partial response to salvage since the API only returns once, in full — and `BaseAgent` discards that turn.
- `getModel()` returns the model id this instance talks to (e.g. `"deepseek-v4-flash"`). It is stamped onto every usage entry the agent records for this provider, so a total can be broken down per model and not just per role — see [Token accounting](./agents.md#token-accounting). A custom provider must implement it; return whatever string identifies the model you're billing against.

- `getCapabilities()` returns a static description used by `BaseAgent` to decide things like when to trigger memory compaction — it is **not** re-queried per call:

```ts
interface ProviderCapabilities {
  supportsTools: boolean;      // must be true — BaseAgent requires native tool-calling
  supportsImages: boolean;     // whether this provider/model accepts image content
  contextWindow: number;       // total context window, in tokens
  safeUsageRatio?: number;     // fraction of contextWindow safe to fill before compacting (default 0.5)
  supportsThinking?: boolean;  // whether reasoning/thinking text is surfaced — see "Think effort" below
  maxOutputTokens?: number;    // the model's max output tokens per response, where confirmed — not yet enforced anywhere, reserved for a future release
  supportsVideo?: boolean;             // whether this provider/model accepts video content
  supportsAudio?: boolean;             // whether this provider/model accepts audio content
  supportsImageGeneration?: boolean;   // whether this provider/model can generate new images
  supportsImageEditing?: boolean;      // whether this provider/model can edit an existing image
  supportsVideoGeneration?: boolean;   // whether this provider/model can generate new video
  supportsVideoEditing?: boolean;      // whether this provider/model can edit existing video
  supportsAudioGeneration?: boolean;   // whether this provider/model can generate new audio (speech, music, sound effects)
  supportsAudioDesign?: boolean;       // whether this provider/model can design/produce sound effects or soundscapes
  supportsAudioClone?: boolean;        // whether this provider/model can clone a voice from a reference sample
  supports3DModelGeneration?: boolean; // whether this provider/model can generate a new 3D model
}
```

These flags describe what the model itself can natively do — they're unrelated to `ProviderType` (see "Provider roles" below), which is just a role name used to look a provider up in a `ProviderRegistry`. A provider registered under the `"image-generation"` role doesn't need `supportsImageGeneration: true` (or vice versa) — the role name and the capability flag are independent. All four built-in providers are chat/vision LLMs, not generation APIs, so every one of the new flags above is always `false` on them.

`BaseAgent.run()` throws immediately if `getCapabilities().supportsTools` is `false` — the legacy JSON-in-text tool-call convention has been removed from the main loop. All providers default `supportsTools` to `true` except Ollama, which defaults it to `false` (many locally-hosted models don't support native function calling; pass `{ supportsTools: true }` explicitly if your model does).

## Changing an option without reconstructing

`setOption(key, value)` mutates an already-constructed provider in place — e.g. `provider.setOption("thinkEffort", 0.8)` — instead of building a new one. Every built-in provider only allows keys it already reads fresh on every `chat()` call (never something baked into derived state at construction, like `contextWindow`); an unrecognized key throws.

| Provider | Settable keys |
|---|---|
| Anthropic | `thinkEffort`, `userId`, `disablePromptCaching`, `maxTokens`, `supportsTools` |
| OpenAI | `thinkEffort`, `userId`, `supportsTools` |
| DeepSeek | `thinkEffort`, `userId`, `supportsTools` |
| Ollama | `thinkEffort`, `supportsTools` |

## Usage on the streaming path

OpenAI and DeepSeek's Chat-Completions-style streaming protocol doesn't compute token usage until a turn is fully complete — it arrives once, in a special final chunk (`stream_options: { include_usage: true }`), alongside `done: true`. Every chunk before that has `usage: { inputMissTokens: 0, inputCacheTokens: 0, outputTokens: 0 }` — not because those numbers are unknown-but-estimated, but because the API genuinely hasn't computed them yet. `OpenAIProvider` and `DeepSeekProvider` both trust this real, provider-reported final chunk directly — no local estimation involved on either. DeepSeek's final chunk includes its own `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` fields (falling back to `prompt_tokens_details.cached_tokens` if those aren't present), parsed the same way real cache data is read from any other provider.

If a call is cut off before that final chunk arrives (e.g. `BaseAgent.immediateStop()` aborting the connection to stop paying for further output), the real usage number simply never gets computed or sent for either provider — not partially, not late, just never — so `inputMissTokens`/`inputCacheTokens`/`outputTokens` stay `0` on `ChatResponse` too in that case. Anthropic doesn't have this problem (it streams real usage incrementally, see [Streaming](./streaming.md#usage-chunks)); Ollama has the same final-chunk-only limitation but isn't covered by what's described here.

This is the only usage source DeepSeek's streaming path has, so it's treated as the real number, not flagged as a lesser "estimate" — whatever lands on the final `done: true` chunk (and the returned `ChatResponse`) is what a consumer should use for billing/accounting, the same as it would for any other provider's real, API-reported usage. The two sides of that number are revealed at different points, though: `outputTokens` grows on every streamed chunk as content arrives, since it's cheap to recompute from what's been generated so far; `inputMissTokens`/`inputCacheTokens` are only computed once, on that final chunk, since the input side never changes mid-call and there's no reason to resend the same number on every content delta.

## Think effort

Reasoning/thinking models each expose a different native "how hard should the model think" knob — OpenAI and Ollama use `low`/`medium`/`high`, DeepSeek uses `none`/`low`/`high`/`max`, Anthropic uses a numeric thinking-token budget. OrbitX replaces all of that with one universal option on every provider's constructor:

```ts
thinkEffort?: number;   // 0-1, e.g. 0.5 or 0.8 — never a provider-specific string
```

Each provider maps that 0-1 value onto whatever scale it actually accepts (`src/core/think-effort.ts`'s `resolveThinkEffortLevel()` buckets it evenly across a provider's supported levels; Anthropic instead scales it into a `budget_tokens` range). A provider or model that doesn't support thinking at all — or doesn't recognize the resulting native value — simply ignores it:

```ts
import { AnthropicProvider, DeepSeekProvider } from "orbitx";

const anthropicProvider = new AnthropicProvider("api-key", "claude-sonnet-5", { thinkEffort: 0.7 });
const deepseekProvider = new DeepSeekProvider("api-key", "deepseek-v4-flash", { thinkEffort: 0.3 });
```

Per-provider specifics:

| Provider | Native scale | Notes |
|---|---|---|
| Anthropic | `thinking.budget_tokens` (numeric) | Scales with `maxTokens`; `max_tokens` sent to the API is automatically bumped so it always exceeds the thinking budget. Signed thinking blocks are carried forward automatically via `Message.providerThinking` when a thinking turn also made a tool call — required by Anthropic's API, handled for you. |
| DeepSeek | `none` / `low` / `high` / `max` | Sent as `reasoning_effort` on reasoner models. |
| OpenAI | `low` / `medium` / `high` | Sent as `reasoning_effort`, and **only** for reasoning-capable model families (`o1`/`o3`/`o4`/`gpt-5*` prefixes) — silently ignored for every other model, since the Chat Completions API rejects the param on non-reasoning models. |
| Ollama | `false` / `low` / `medium` / `high` | `thinkEffort <= 0` maps to `false` (works as an on/off switch for models that only understand a boolean, e.g. deepseek-r1/qwen3); higher values map to a level string for models that support graded effort (e.g. gpt-oss). |

See [Streaming](./streaming.md#thinking-chunks) for how (and whether) a given provider's reasoning text is observable while it streams.

## User tracking & prompt caching

Every provider's constructor accepts `userId?: string` — an opaque end-user identifier forwarded to the underlying API for that provider's own abuse-monitoring/analytics, same universal-option pattern as `thinkEffort`: pass it uniformly and providers that have no equivalent field just ignore it.

| Provider | Where `userId` goes | Notes |
|---|---|---|
| Anthropic | `metadata.user_id` on every request | Anthropic's documented field for this purpose. |
| OpenAI | `user_id` on every request | Sent as an extra body field alongside the standard params. |
| DeepSeek | `user_id` on every request | Same mechanism as OpenAI (DeepSeek's API is OpenAI-compatible). |
| Ollama | Ignored | Accepted in the options type for interface parity only — Ollama's API has no equivalent field. |

**Anthropic prompt caching is on by default.** Every request marks the last content block with an ephemeral `cache_control` breakpoint, so a growing conversation gets served from cache instead of being fully reprocessed each turn — pass `disablePromptCaching: true` to send every request uncached. DeepSeek's cache is automatic server-side (no `cache_control` equivalent to toggle) and reports its own explicit `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`. OpenAI's cache is also automatic, reporting hits via `prompt_tokens_details.cached_tokens`. Ollama has no cache concept at all — `inputCacheTokens` is always `0`.

## Built-in providers

### Ollama

```ts
import { OllamaProvider } from "orbitx";

new OllamaProvider(model: string, host = "http://localhost:11434", options?: {
  supportsTools?: boolean;   // default false
  contextWindow?: number;    // default 32_000
  thinkEffort?: number;      // 0-1, see "Think effort" above
  userId?: string;           // accepted for interface parity only — ignored, Ollama has no equivalent field
});
```

Wraps the `ollama` npm package, talking to a local (or remote) Ollama server. Always reports `supportsImages: true`.

### DeepSeek

```ts
import { DeepSeekProvider } from "orbitx";

new DeepSeekProvider(apiKey: string, model = "deepseek-v4-flash", options?: {
  supportsTools?: boolean;   // default true
  supportsImages?: boolean;  // default: true only for deepseek-v4-flash-vision-exp
  contextWindow?: number;    // default 1_000_000 (deepseek-v4-flash / deepseek-v4-flash-vision-exp / deepseek-v4-pro)
  thinkEffort?: number;      // 0-1, see "Think effort" above
  userId?: string;           // see "User tracking & prompt caching" above
});
```

Uses the `openai` SDK pointed at `https://api.deepseek.com` (DeepSeek's API is OpenAI-compatible). `getCapabilities().supportsImages` is `false` for every model except `deepseek-v4-flash-vision-exp`, which is `deepseek-v4-flash` plus native image input (same context window, same reasoning support) — pass `supportsImages: true` explicitly if a future model adds vision support before this SDK's allowlist is updated.

`stream_options: { include_usage: true }` is set on every streaming call, so `inputMissTokens`/`inputCacheTokens`/`outputTokens` are accurate on both the streaming and non-streaming paths — DeepSeek sends a usage-bearing final chunk (including its own `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` split) the same way OpenAI does.

### Anthropic

```ts
import { AnthropicProvider } from "orbitx";

new AnthropicProvider(apiKey: string, model = "claude-sonnet-5", options?: {
  supportsTools?: boolean;    // default true
  supportsImages?: boolean;   // default true
  contextWindow?: number;     // default from a per-model table, else 200_000; an explicit value here always wins over extendedContext below
  maxTokens?: number;         // output token cap, default 4096
  thinkEffort?: number;       // 0-1, see "Think effort" above
  userId?: string;            // see "User tracking & prompt caching" above
  disablePromptCaching?: boolean;  // default false — prompt caching is on by default, see above
  extendedContext?: boolean | string;  // default false/undefined — see "Context window" below
});
```

Wraps `@anthropic-ai/sdk`. `maxTokens` is the only provider with an explicit output-length cap in its options today.

### OpenAI

```ts
import { OpenAIProvider } from "orbitx";

new OpenAIProvider(apiKey: string, model = "gpt-5", options?: {
  supportsTools?: boolean;    // default true
  supportsImages?: boolean;   // default true unless model is in a small denylist (e.g. o3-mini, o1-mini)
  contextWindow?: number;     // default from a per-model table, else 128_000
  baseURL?: string;           // point at an OpenAI-compatible endpoint
  thinkEffort?: number;       // 0-1, see "Think effort" above — ignored on non-reasoning models
  userId?: string;            // see "User tracking & prompt caching" above
});
```

Uses the Chat Completions API (not the Responses API). `baseURL` makes this usable against any OpenAI-compatible provider, not just OpenAI itself.

## Provider roles

An agent's providers are registered under open-ended role names, not a fixed pair. `"main"` — the provider driving the agent loop itself — is the only one that's required; every other role is optional and looked up on demand by whatever tool needs it.

```ts
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
```

`ProviderType` (exported from `orbitx`) is the documented starting vocabulary for every role name — not a closed union, and purely for naming/registry lookup. It has no relationship to `ProviderCapabilities` (see above) — a role name doesn't imply anything about what the provider registered under it can actually do. The trailing `(string & {})` (not bare `string`) is what makes the open-endedness work: a plain `| string` union collapses to just `string` and an editor stops suggesting the literals at all, while intersecting with `{}` keeps TS from widening it away, so a custom name still type-checks the moment nothing here fits. `llm-low`/`medium`/`high` are a self-declared overall quality/durability tier (cheap-and-good-enough vs. worth relying on for longer/harder tasks) — not a specific claim about reasoning power.

Pass a single provider to use it as `main` (same as today); pass an array of `{ type, provider, default? }` entries to register more:

```ts
import { BaseAgent, DeepSeekProvider, OllamaProvider } from "orbitx";

const agent = new BaseAgent({
  aiProvider: [
    { type: "main", provider: new DeepSeekProvider("api-key", "deepseek-v4-flash") },
    { type: "image-describer", provider: new OllamaProvider("llava:latest") },
  ],
  instruction: "You are a helpful assistant.",
  mcpClient,
  allowedTools: [/* ... */],
});
```

`provider` can also be an array — a pool of candidates for that role — with `default` (0-based, defaults to `0`) picking which one is used when code needs exactly one. The rest of the pool is there to be enumerated later; nothing built-in does smarter selection than "the default" yet.

### Resolving a provider by role

`ProviderRegistry.getProvider(type)` tries an exact role-name match first (that role's pool default). If nothing is registered under `type`, it falls back to scanning every provider registered under *any* role for the first one whose `getCapabilities()` reports the matching capability flag — not a generic capability bag keyed by `ProviderType` (that's gone; `ProviderType` is purely a registry role name and has no relationship to what a model can do), but a fixed, small mapping from a handful of well-known role names to their one corresponding `ProviderCapabilities` flag:

| Role (`ProviderType`) | Capability flag checked in the fallback |
|---|---|
| `"image-describer"` | `supportsImages` |
| `"image-generation"` | `supportsImageGeneration` |
| `"image-editing"` | `supportsImageEditing` |
| `"video-describer"` | `supportsVideo` |
| `"video-generation"` | `supportsVideoGeneration` |
| `"video-editing"` | `supportsVideoEditing` |
| `"audio-describer"` | `supportsAudio` |
| `"audio-generation"` | `supportsAudioGeneration` |
| `"audio-design"` | `supportsAudioDesign` |
| `"audio-clone"` | `supportsAudioClone` |
| `"3d-model-generator"` | `supports3DModelGeneration` |

This is why a single vision-capable `main` provider "just works" as an image describer with zero extra config: nothing needs to be registered under `"image-describer"` explicitly — the fallback finds `main` because its `getCapabilities().supportsImages` is `true`. Role names outside this table (`"main"`, `"llm-low"`/`"medium"`/`"high"`, or any custom string) have no capability equivalent, so the fallback never applies to them — an unregistered role like that returns `undefined` from `getProvider` regardless of what any registered provider can do.

`BaseAgent` calls `getProvider` directly, and so does `SwarmBase` when an agent is part of a swarm (see [Swarm](./swarm.md#providers-a-tool-reaches-for)) — a tool never touches a `ProviderRegistry`, or a raw provider, itself. It reaches this indirectly via `mcp.executeProvider(toolCallId, type, input)` (see [Tools](./tools.md#mcpexecuteprovider--calling-a-provider-from-inside-a-tool)), which works the same way whether the tool is registered on the local `MCPClient` or a sandboxed/remote `MCPServer` — the request is always resolved on `BaseAgent`'s side, never handed across as a live object.

`resolveAgentProviders()` (`AgentProvidersInput = AIProvider | AgentProviderEntry[]`) builds the `ProviderRegistry` this all runs on — both are exported from `orbitx` if you need them directly (`getMain()`, `getProvider(type)`, `getProviders(type)` for the full pool under an exact role). There is no separate "utils" role — every tool/skill is included in the system prompt from the start, so there's nothing left for a separate pass to decide.

## Writing a custom provider

Extend `AIProvider` and implement `chat`/`getCapabilities`. Follow an existing provider (e.g. `src/core/ollama-provider.ts`) as a template: translate `Message[]` to your API's wire format, stream text chunks to `streamCallback` as they arrive, accumulate tool-call deltas and emit them on the final chunk, and translate `ToolSchema[]` into your API's function-calling format (see `src/core/tool-schema-translator.ts` for existing OpenAI/Anthropic translators you can reuse or reference).

`inputMissTokens`/`inputCacheTokens`/`outputTokens` on the returned `ChatResponse` are optional — every built-in provider is token-billed and always sets them, but a provider registered under a per-request-billed role (e.g. `image-generation`, `audio-clone`) should omit them and set `cost` instead. `BaseAgent#executeProvider` (see [Tools](./tools.md#mcpexecuteprovider--calling-a-provider-from-inside-a-tool)) checks `cost` first and records a `unit: "cost"` usage entry (stamped with the provider's `getModel()`, like every other entry) when it's present, falling back to the token fields (defaulting any missing one to `0`) otherwise — see [Token accounting](./agents.md#token-accounting).
