# Agents

## `BaseAgent` vs `SimpleAgent`

- **`BaseAgent`** (`src/core/base-agent.ts`) is the real engine — the run loop, memory compaction, tool dispatch, token accounting. It requires you to bring your own `MCPClient` (and therefore your own `MCPServer`/connection), which is what gives you the choice of in-process, IPC, or WebSocket execution (see [MCP Architecture](./mcp-architecture.md)).
- **`SimpleAgent`** (`src/templates/simple.ts`) is a thin subclass that wires up an in-process `MCPConnection` + `MCPServer` + `MCPClient` for you from a flat `tools`/`skills` list. Use this unless you specifically need a different transport.

## `BaseAgent` constructor

```ts
new BaseAgent({
  instruction: string;
  allowedTools: MCPTool<any>[];
  aiProvider: AIProvider | AgentProviderEntry[];   // see Providers doc
  mcpClient: MCPClient;
  skills?: Skill[];
  maxMemorizeToken?: number;   // default: derived from the main provider's contextWindow * safeUsageRatio
  initData?: {
    memory: string;
    messagesFull: Message[];
    fullInputMissTokens: number;
    fullInputHitTokens: number;
    fullOutputTokens: number;
    messagesCompact: Message[];
    currentInputMissTokens: number;
    currentInputHitTokens: number;
    currentOutputTokens: number;
  };
});
```

`SimpleAgent`'s constructor is the same shape minus `mcpClient`/`allowedTools` (it builds those from `tools`), plus `tools?: MCPTool<any>[]` and `maxMemorizeToken` defaulting to `16000` instead of being derived.

## The run loop

```ts
await agent.run(prompt: string, streamCallback?: StreamCallback): Promise<void>;
```

Each call to `run()`:

1. Pushes the user prompt onto the message history and emits it as a `role: "user"` stream chunk.
2. Sends `[system, ...history]` plus the full tool schema list to the main provider's `chat()`.
3. If the model requested tool calls, dispatches each one (via the `MCPClient` this agent was built with), pushes a `role: "tool"` message + stream chunk per result, and loops back to step 2.
4. Repeats until the model's turn produces no tool calls (or a tool marked `stopIterationAfterUsingThisTool` fired — see [Tools](./tools.md)).

If `run()` is called again while a previous call is still in flight, the new call is queued and resolves once the current run finishes (or times out after 4 minutes) — it does not run concurrently or interleave.

`stop()` requests the current run stop at the next safe point; it resolves once the loop has actually stopped, or rejects if it doesn't stop within 4 minutes.

### Native tool-calling is required

`run()` throws immediately if the main provider's `getCapabilities().supportsTools` is `false`. There is no legacy JSON-in-text fallback in the main loop anymore — pick a provider/model combination (or pass `{ supportsTools: true }`) that supports native function calling.

## Memory compaction

OrbitX never truncates or deletes conversation history. Instead, `BaseAgent` tracks two token totals per run: `currentInputMissTokens` (uncached input) and `currentLastOutputTokens` (the last turn's output). When their sum exceeds `maxMemorizeToken`:

1. The agent asks the main provider to summarize the conversation so far into a single JSON tool call (`{"tool":"set_memory","inputs":{"new_memory":"..."}}`), which becomes the running `memory` string injected into every future system prompt (`MEMORY:` section).
2. `messagesCompact` — the *working* context sent to the provider each turn — is cleared.
3. `messagesFull` — the complete, ever-appended history — is untouched, so nothing is lost; it's just no longer replayed to the model every turn.
4. If no tool was called this turn (i.e. compaction happened on an otherwise-idle turn), the agent auto-continues with a synthetic "Continue where you left off, using MEMORY above for context." prompt so the model doesn't just stop mid-task.

`maxMemorizeToken`, if not passed explicitly, is derived as `contextWindow * safeUsageRatio` (default ratio `0.5`) from the main provider's `getCapabilities()` — so it scales automatically with whatever model you plug in.

## Persisting and resuming state

`getCurrentAgentStates()` returns exactly the shape expected by the `initData` constructor option — `memory`, `messagesFull`, `messagesCompact`, and all six token counters. Serialize it (it's plain JSON) after any `run()` call, and pass it back into a fresh `BaseAgent`/`SimpleAgent` to resume — same conversation, same memory, same token history. See the example in [Getting Started](./getting-started.md#recovering-an-agents-state).

## Token accounting

Three read methods, all returning `{ total, inputHit, inputMiss, output }`:

- `getCurrentTotalTokens()` — tokens used since the last memory compaction.
- `getFullTotalTokens()` — tokens used across all *prior* compacted segments.
- `getTotalTokens()` — the sum of both (lifetime total for this agent instance).

`inputHit`/`inputMiss` track cached vs. uncached input tokens, since the compacted-context-replay pattern means most of a long conversation's prefix is a cache hit on providers that support prompt caching.

## Instructions, skills, and memory in the system prompt

The system prompt is built once (lazily, on first use) and never changes for the lifetime of an agent instance — a stable prefix, which matters for provider-side prompt caching. It's assembled from: a fixed "you have tools" preamble, each skill's name/description/instructions (see [Skills](./skills.md)), the current `MEMORY:` block, and your `instruction` string, in that order.
