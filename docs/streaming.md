# Streaming

`agent.run(prompt, streamCallback)` and `AIProvider.chat(messages, streamCallback, tools)` both accept an optional `StreamCallback`:

```ts
type StreamCallback = (chunk: {
  role: "assistant" | "tool" | "user";
  content: string;
  done: boolean;
  toolCalls?: ToolCallRequest[];  // a single just-finished call, as a 1-element array — see "Incremental tool-call chunks" below
  toolCallId?: string;            // on "tool"-role chunks
  toolName?: string;              // on "tool"-role chunks
  thinking?: string;               // reasoning-text delta, mirroring `content` — see "Thinking chunks" below
  usage?: { inputMissTokens: number; inputCacheTokens: number; outputTokens: number };  // see "Usage chunks" below
  hidden?: boolean;                // true on messages BaseAgent injected itself
}) => Promise<void> | void;
```

## What you actually receive, turn by turn

1. **`role: "user"`** — one chunk, `done: true`, echoing the prompt that was just added to history (either the one you passed to `run()`, or a queued one — see [Agents](./agents.md#the-run-loop)). One exception: the forced-compaction nudge (see [Agents](./agents.md#memory-compaction)) is also a `role: "user"` chunk, but carries `hidden: true` since it's `BaseAgent` talking to the model, not the actual user — check that flag before showing a `"user"` chunk to an end user.
2. **`role: "assistant"`** — the model's reply, streamed incrementally: zero or more `done: false` chunks each carrying the next slice of `content` as it arrives from the provider, followed by one final `done: true` chunk. `content` is delta text, not the accumulated total — append it yourself if you need the running message.
   - If the model requested tool calls this turn, each one is emitted individually, mid-stream, as soon as *that* call finishes generating — `toolCalls: [thatOneCall]` on a `done: false` chunk. See "Incremental tool-call chunks" below.
3. **`role: "tool"`** — one chunk per dispatched tool call, `done: true`, with `content` set to the tool's result text and `toolCallId`/`toolName` identifying which call it answers. Emitted after the tool has actually finished executing (there is no streaming/progress signal for tool execution itself through this callback — see below for how to get that separately).

A full run of "call one tool, then answer" therefore looks like:

```
{ role: "user", content: "<prompt>", done: true }
{ role: "assistant", content: "<partial>", done: false }   // repeated
{ role: "assistant", content: "", done: false, toolCalls: [{...}] }
{ role: "assistant", content: "", done: true }
{ role: "tool", content: "<result>", done: true, toolCallId, toolName }
{ role: "assistant", content: "<partial>", done: false }   // repeated
{ role: "assistant", content: "", done: true }
```

Note the final `done: true` chunk for the tool-call turn carries no `toolCalls` — every call this turn was already streamed individually by the time it arrives, so resending the full list would just be a duplicate. If you need the complete, aggregated list for a turn (e.g. you're driving `AIProvider.chat()` directly rather than going through `agent.run()`), it's on the returned `ChatResponse.toolCalls` instead — see below.

## Incremental tool-call chunks

Deciding *whether* to call a tool and building its arguments is itself something the model streams token by token — so as soon as one call's arguments are fully generated, that call is emitted on its own as `toolCalls: [thatOneCall]`, without waiting for the rest of the turn (more tool calls, or trailing text) to finish too. This is purely observational: it exists so a consumer can show "the model just decided to call `X`" the moment it happens.

**It does not change when a tool actually runs.** Dispatch is still all-or-nothing at the end of the turn: `BaseAgent` only executes tool calls after `AIProvider.chat()` fully resolves and returns the complete `ChatResponse.toolCalls` array — nothing is ever called early just because its single-call chunk arrived first. If you want to reconcile the two: the incremental `toolCalls: [...]` chunks tell you a call was *decided*, in the order the model produced them; the eventual `role: "tool"` result chunks tell you a call was *executed*, in whatever order `BaseAgent` dispatches them.

Detection differs by provider, since not every API has an explicit "this call is done" signal:

| Provider | How completion is detected |
|---|---|
| Anthropic | Native `content_block_stop` event — exact and immediate. |
| OpenAI / DeepSeek | Inferred: the API streams one call's arguments at a time with no end marker, so a call is treated as finished the instant the *next* call's first delta (carrying a fresh `id`) arrives, or the stream ends (for the last/only call). |
| Ollama | Ollama sends each tool call already fully formed (not built up token by token), so it's emitted the moment it's seen — deduplicated in case the same call reappears in a later chunk. |

## Usage chunks

Every `assistant`-role chunk carries `usage` — not just the ones with a fresh number to report. Where a value isn't known yet, it's an explicit `0`, never an absent/undefined field, so consuming code can always read `chunk.usage.outputTokens` etc. without separately guarding for `usage` or its fields being missing. This is the same `streamCallback` passed into `run()`, forwarded straight through to the provider, so external code (e.g. something watching an external credit/cost budget, deciding when to call `immediateStop()`) sees it too — no separate channel.

Every number here is real, straight from whatever the provider reports — nothing in this SDK estimates or guesses a token count. What differs is *when* each field stops being a placeholder `0` and starts reflecting the API's real number:

| Provider | Mid-stream `usage` | Final `usage` (on `done: true`) |
|---|---|---|
| Anthropic | `inputMissTokens`/`inputCacheTokens` are real from the very first chunk (before any content) — that's simply when its protocol first has them, not something computed early on purpose. `outputTokens` updates on every delta. | Same numbers, just the last update. |
| OpenAI | All three fields are `0` on every chunk before the last one (`include_usage` is honored correctly, but only delivers on completion — there's nothing to report early). | Real, billed numbers for all three fields. If the call is cut off before this chunk arrives, `inputMissTokens`/`inputCacheTokens`/`outputTokens` come back `0` on `ChatResponse` too — the API never computed them, so there's nothing to report. |
| DeepSeek | Same as OpenAI — `0` on every chunk before the last one. | Real, billed numbers, including its own `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` for the cache split. Same `0`-on-abort behavior as OpenAI if the call is cut off first. |
| Ollama | All three fields are `0` on every chunk before the last one — no live signal exists for this provider at all. | Real. |

Practical implication: for Anthropic and DeepSeek you get a live, reactable signal before a turn finishes (immediately for Anthropic's input side, throughout for either provider's output side); for OpenAI there's no live signal at all today — you only find out after the turn finishes, or get a hard `0` if it was cut off first.

## Minimal consumer

```ts
let oldRole: "assistant" | "tool" | "user" | undefined;

agent.run("what is current time?", (chunk) => {
  if (oldRole !== chunk.role) {
    process.stdout.write(`\n${chunk.role}: `);
    oldRole = chunk.role;
  }

  if (chunk.thinking) {
    process.stdout.write(`\x1b[2m${chunk.thinking}\x1b[0m`); // dim, to visually separate it from the answer
  } else {
    process.stdout.write(chunk.content);
  }

  if (chunk.toolCalls?.length) {
    console.log("decided to call:", chunk.toolCalls[0]);
  }
  if (chunk.role === "tool") {
    console.log({ toolCallId: chunk.toolCallId, toolName: chunk.toolName });
  }

  if (chunk.done) {
    process.stdout.write("\n\n");
    oldRole = undefined;
  }
});
```

## Thinking chunks

When a provider is constructed with `thinkEffort` (see [Providers](./providers.md#think-effort)) and it can actually surface reasoning text (`getCapabilities().supportsThinking`), that text streams incrementally too — as `role: "assistant"` chunks carrying their delta on `thinking` instead of `content`, interleaved *before* the model's normal answer chunks in the same turn:

```
{ role: "assistant", content: "", done: false, thinking: "<reasoning...>" }   // repeated
{ role: "assistant", content: "<answer...>", done: false }                    // thinking absent from here on
{ role: "assistant", content: "", done: true }
```

`thinking` mirrors `content`: a chunk carries text on exactly one of the two, never both, and `thinking` is only ever present on non-`done` chunks — the final `done: true` chunk never carries it. Once accumulated, the full reasoning text for the turn is also available non-streaming on `ChatResponse.thinking` / `Message.thinking` (e.g. for logging or persisting alongside the answer).

Support varies by provider — set `thinkEffort` and check `getCapabilities().supportsThinking` before assuming thinking chunks will actually arrive:

| Provider | Streams `thinking` chunks? |
|---|---|
| Anthropic | Yes — native `thinking_delta` events. |
| DeepSeek | Yes — `delta.reasoning_content` on reasoner models. |
| Ollama | Yes — `message.thinking` on models that support it. |
| OpenAI | **No.** `thinkEffort` is still honored server-side (via `reasoning_effort`) on reasoning-capable models, but the Chat Completions API this provider uses never returns the reasoning text itself — there's nothing to stream. |

### `thinking` vs `providerThinking` on `Message`/`ChatResponse`

Once a turn finishes, its accumulated reasoning is available two ways on both `ChatResponse` (returned from `AIProvider.chat()`) and `Message` (as stored in an agent's history):

- **`thinking?: string`** — the plain reasoning text, for display or logging. Never required by any provider's API; read-only from your side.
- **`providerThinking?: any[]`** — opaque, provider-specific data (currently only Anthropic populates this: signed `thinking` content blocks). When a turn both thinks and calls a tool, Anthropic's API requires the exact signed thinking block(s) from that turn to be replayed verbatim on the next request or it rejects the call. `BaseAgent` carries this field through automatically when it builds the next turn's message history, so if you're using `BaseAgent`/`SimpleAgent` you never touch it directly. It only matters if you're driving an `AIProvider` yourself (see [Providers](./providers.md)) — in that case, copy `providerThinking` from the response straight onto the `Message` you push for that assistant turn, unchanged.

## What's *not* in the stream today

- **No live per-tool progress channel through `StreamCallback`.** There's no built-in way to observe a long-running tool call (browser navigation, a bash process) mid-flight — `execute()` runs to completion and its return value is the only thing surfaced.
- **Tool calls still only appear once, fully assembled** — see above. `thinkEffort`/thinking chunks don't change that.

If your use case depends on either of these, check the project's issue tracker / recent changes before assuming they're unavailable — this area of the SDK is actively evolving.
