# Providers

An `AIProvider` is OrbitX's abstraction over a model API. All four built-in providers implement the same interface (`src/core/ai-provider.ts`):

```ts
abstract class AIProvider {
  abstract chat(
    messages: Message[],
    streamCallback?: StreamCallback,
    tools?: ToolSchema[]
  ): Promise<ChatResponse>;

  abstract getCapabilities(): ProviderCapabilities;
}
```

- `chat` sends the full message history (plus a provider-agnostic `tools` schema, when supplied) and returns a `ChatResponse` (`{ content, inputTokens, outputTokens, toolCalls? }`). If `streamCallback` is passed, text is streamed to it incrementally as it arrives — see [Streaming](./streaming.md).
- `getCapabilities()` returns a static description used by `BaseAgent` to decide things like when to trigger memory compaction — it is **not** re-queried per call:

```ts
interface ProviderCapabilities {
  supportsTools: boolean;     // must be true — BaseAgent requires native tool-calling
  supportsImages: boolean;    // whether this provider/model accepts image content
  contextWindow: number;      // total context window, in tokens
  safeUsageRatio?: number;    // fraction of contextWindow safe to fill before compacting (default 0.5)
}
```

`BaseAgent.run()` throws immediately if `getCapabilities().supportsTools` is `false` — the legacy JSON-in-text tool-call convention has been removed from the main loop. All providers default `supportsTools` to `true` except Ollama, which defaults it to `false` (many locally-hosted models don't support native function calling; pass `{ supportsTools: true }` explicitly if your model does).

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

## Built-in providers

### Ollama

```ts
import { OllamaProvider } from "orbitx";

new OllamaProvider(model: string, host = "http://localhost:11434", options?: {
  supportsTools?: boolean;   // default false
  contextWindow?: number;    // default 32_000
  thinkEffort?: number;      // 0-1, see "Think effort" above
});
```

Wraps the `ollama` npm package, talking to a local (or remote) Ollama server. Always reports `supportsImages: true`.

### DeepSeek

```ts
import { DeepSeekProvider } from "orbitx";

new DeepSeekProvider(apiKey: string, model = "deepseek-v4-flash", options?: {
  supportsTools?: boolean;   // default true
  contextWindow?: number;    // default 1_000_000 (deepseek-v4-flash / deepseek-v4-pro)
  thinkEffort?: number;      // 0-1, see "Think effort" above
});
```

Uses the `openai` SDK pointed at `https://api.deepseek.com` (DeepSeek's API is OpenAI-compatible). Always reports `supportsImages: false`.

### Anthropic

```ts
import { AnthropicProvider } from "orbitx";

new AnthropicProvider(apiKey: string, model = "claude-sonnet-5", options?: {
  supportsTools?: boolean;    // default true
  supportsImages?: boolean;   // default true
  contextWindow?: number;     // default from a per-model table, else 200_000
  maxTokens?: number;         // output token cap, default 4096
  thinkEffort?: number;       // 0-1, see "Think effort" above
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
});
```

Uses the Chat Completions API (not the Responses API). `baseURL` makes this usable against any OpenAI-compatible provider, not just OpenAI itself.

## Two provider roles: main + image

An agent has exactly two provider "roles":

- **`main`** — drives the agent loop itself (required).
- **`image`** — describes image tool output (e.g. a screenshot from `BrowserScreenshotTool`) into text, so the main conversation doesn't have to carry raw image bytes. Optional.

Pass a single provider to use it for both roles (if it supports images, it's also used as the image describer; otherwise images are dropped with an explanatory error message back to the model). Pass an array to split them:

```ts
import { BaseAgent, DeepSeekProvider, OllamaProvider } from "orbitx";

const agent = new BaseAgent({
  aiProvider: [
    { type: "main", aiProvider: new DeepSeekProvider("api-key", "deepseek-v4-flash") },
    { type: "image", aiProvider: new OllamaProvider("llava:latest") },
  ],
  instruction: "You are a helpful assistant.",
  mcpClient,
  allowedTools: [/* ... */],
});
```

This resolution is done by `resolveAgentProviders()` (`AgentProvidersInput = AIProvider | AgentProviderEntry[]`), exported from `orbitx` if you need it directly. There is no third "utils" role — every tool/skill is included in the system prompt from the start, so there's nothing left for a separate pass to decide.

## Writing a custom provider

Extend `AIProvider` and implement `chat`/`getCapabilities`. Follow an existing provider (e.g. `src/core/ollama-provider.ts`) as a template: translate `Message[]` to your API's wire format, stream text chunks to `streamCallback` as they arrive, accumulate tool-call deltas and emit them on the final chunk, and translate `ToolSchema[]` into your API's function-calling format (see `src/core/tool-schema-translator.ts` for existing OpenAI/Anthropic translators you can reuse or reference).
