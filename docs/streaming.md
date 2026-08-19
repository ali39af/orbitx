# Streaming

`agent.run(prompt, streamCallback)` and `AIProvider.chat(messages, streamCallback, tools)` both accept an optional `StreamCallback`:

```ts
type StreamCallback = (chunk: {
  role: "assistant" | "tool" | "user";
  content: string;
  done: boolean;
  toolCalls?: ToolCallRequest[];  // only on the final ("done") assistant chunk, if the model called tools
  toolCallId?: string;            // on "tool"-role chunks
  toolName?: string;              // on "tool"-role chunks
  thinking?: string;               // reasoning-text delta, mirroring `content` — see "Thinking chunks" below
}) => Promise<void> | void;
```

## What you actually receive, turn by turn

1. **`role: "user"`** — one chunk, `done: true`, echoing the prompt that was just added to history (either the one you passed to `run()`, or a queued one — see [Agents](./agents.md#the-run-loop)).
2. **`role: "assistant"`** — the model's reply, streamed incrementally: zero or more `done: false` chunks each carrying the next slice of `content` as it arrives from the provider, followed by one final `done: true` chunk. `content` is delta text, not the accumulated total — append it yourself if you need the running message.
   - If the model requested tool calls this turn, they only appear on that final `done: true` chunk, as a fully-assembled `toolCalls` array — **not** streamed incrementally. Every built-in provider accumulates tool-call argument deltas internally across the whole response and emits them once, complete, at the end.
3. **`role: "tool"`** — one chunk per dispatched tool call, `done: true`, with `content` set to the tool's result text and `toolCallId`/`toolName` identifying which call it answers. Emitted after the tool has actually finished executing (there is no streaming/progress signal for tool execution itself through this callback — see below for how to get that separately).

A full run of "call one tool, then answer" therefore looks like:

```
{ role: "user", content: "<prompt>", done: true }
{ role: "assistant", content: "<partial>", done: false }   // repeated
{ role: "assistant", content: "", done: true, toolCalls: [...] }
{ role: "tool", content: "<result>", done: true, toolCallId, toolName }
{ role: "assistant", content: "<partial>", done: false }   // repeated
{ role: "assistant", content: "", done: true }
```

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

  if (chunk.done && chunk.role === "assistant" && chunk.toolCalls?.length) {
    console.log(chunk.toolCalls);
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

- **No live per-tool progress channel through `StreamCallback`.** For domains that emit their own progress (browser navigation, long-running bash processes), subscribe to that domain's `*Interaction` `EventEmitter` directly instead (e.g. `BrowserInteraction`, `BashInteraction`) — see [Tools](./tools.md).
- **Tool calls still only appear once, fully assembled** — see above. `thinkEffort`/thinking chunks don't change that.

If your use case depends on either of these, check the project's issue tracker / recent changes before assuming they're unavailable — this area of the SDK is actively evolving.
