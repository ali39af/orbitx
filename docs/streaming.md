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
  process.stdout.write(chunk.content);

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

## What's *not* in the stream today

- **No separate "thinking"/reasoning-token chunk type.** Only plain assistant `content` text is streamed; a reasoning model's thinking output is not currently surfaced through `StreamCallback` at all.
- **No live per-tool progress channel through `StreamCallback`.** For domains that emit their own progress (browser navigation, long-running bash processes), subscribe to that domain's `*Interaction` `EventEmitter` directly instead (e.g. `BrowserInteraction`, `BashInteraction`) — see [Tools](./tools.md).

If your use case depends on either of these, check the project's issue tracker / recent changes before assuming they're unavailable — this area of the SDK is actively evolving.
