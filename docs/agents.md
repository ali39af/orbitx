# Agents

## `BaseAgent` vs `SimpleAgent`

- **`BaseAgent`** (`src/core/base-agent.ts`) is the real engine — the run loop, memory compaction, tool dispatch, token accounting. It requires you to bring your own `MCPClient` (and therefore your own `MCPServer`/connection), which is what gives you the choice of in-process, IPC, or WebSocket execution (see [MCP Architecture](./mcp-architecture.md)).
- **`SimpleAgent`** (`src/templates/simple.ts`) is a thin subclass that wires up an in-process `MCPConnection` + `MCPServer` + `MCPClient` for you from a flat `tools`/`skills` list. Use this unless you specifically need a different transport.
- **`WorkerAgent`** *(experimental)* (`src/core/worker-agent.ts`) is a `BaseAgent` with an identity — name, description, per-task-type rating — so another agent can list, compare, hire, and prompt it as a sub-agent. See [Multi-agent: WorkerAgent](#multi-agent-workeragent-experimental) below.

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

## Multi-agent: `WorkerAgent` *(experimental)*

**Experimental:** this whole feature (`WorkerAgent`, `AgentTools`, `AgentReportTool`) is new and still settling — names, the hire/prompt/report shape, and the fallback behavior when a worker never reports may change in a future release. Treat it as unstable if you're building something you don't want to have to revisit.

`WorkerAgent` (`src/core/worker-agent.ts`) is a `BaseAgent` with three extra fields on top of the usual constructor options:

```ts
new WorkerAgent({
  name: string;           // unique id used to hire/prompt this worker
  description: string;    // persona/specialty, written for a hiring agent to judge fit from
  rating?: Record<string, number>;  // per-task-type fit score, e.g. { backend: 9, "3d-web": 10 }, convention 0-10
  // ...plus every BaseAgent option: instruction, allowedTools, aiProvider, mcpClient, skills?, maxMemorizeToken?, initData?
});

worker.getName();
worker.getDescription();
worker.getRating();
```

It's a raw building block, same as `BaseAgent` — you still bring your own `mcpClient`/`allowedTools` for it. The only thing `WorkerAgent` adds is identity metadata; running it (`.run()`, streaming, memory, tokens) is unchanged.

### The `agent-*` tools

`AgentTools(availableAgents: WorkerAgent[], options?: { maxHired?: number })` (from `src/tools/agent/`) builds a fixed roster of hireable workers into three planner-facing tools:

| Tool | Purpose |
|---|---|
| `agent-list` | List every worker in the roster — name, description, rating, and whether it's currently hired. Also returns `hiredCount` and (when set) `maxHired`. |
| `agent-hire` | Hire a worker by name, making it eligible for `agent-prompt`. Hiring an already-hired worker is a no-op. |
| `agent-prompt` | Send a prompt to a hired worker and wait for its response. |

`maxHired` caps how many workers can be hired at once — omit it for no limit. When set, it's woven directly into `agent-hire`'s own tool description (so the model learns the constraint from the tool itself, not out-of-band instructions) and exceeding it throws a clear error naming the current limit and who's currently hired. Re-hiring an already-hired worker is still a free no-op and never counts against the cap.

Give these to your **planner** agent (the one that decides which workers to use), not to the workers themselves:

```ts
import { AgentTools, SimpleAgent, WorkerAgent, AnthropicProvider, AgentReportTool, MCPConnection, MCPServer, MCPClient } from "orbitx";

function buildWorker(name: string, description: string, rating: Record<string, number>) {
  const connection = new MCPConnection();
  const server = new MCPServer(connection);
  const reportTool = AgentReportTool();
  server.registerTool(reportTool);
  // ...register whatever other tools this worker needs on `server` too...

  return new WorkerAgent({
    name,
    description,
    rating,
    instruction: `You are the ${name} specialist.`,
    aiProvider: new AnthropicProvider("api-key", "claude-sonnet-5"),
    mcpClient: new MCPClient(name, connection),
    allowedTools: [reportTool /* , ...other tools registered above */],
  });
}

const backendWorker = buildWorker("backend-worker", "Node.js APIs, databases, servers.", { backend: 9, frontend: 2 });
const frontendWorker = buildWorker("frontend-worker", "React UI work.", { backend: 2, frontend: 9 });

const planner = new SimpleAgent({
  aiProvider: new AnthropicProvider("api-key", "claude-sonnet-5"),
  instruction: "You coordinate work across specialist worker agents.",
  // At most 1 hired at a time here, just as an example constraint.
  tools: AgentTools([backendWorker, frontendWorker], { maxHired: 1 }),
});
```

### `agent-report` — for workers, not the planner

Include `AgentReportTool()` in each **worker's own** `allowedTools` (and register it on that worker's own `MCPServer`, as in the example above) — it's what lets a worker hand a result back once it's done. Calling it always ends the worker's current turn immediately (`stopIterationAfterUsingThisTool`), so a worker should call it and stop, not keep reasoning afterward.

### How a prompt/report round-trip actually works

1. Planner calls `agent-hire`, then `agent-prompt` with a task.
2. `agent-prompt`'s implementation calls `workerAgent.run(prompt)` and waits for it to resolve — the worker runs its own full turn (its own reasoning, its own tools), completely independently of the planner's own loop.
3. Once the worker's `run()` resolves, `agent-prompt` looks at only the messages that turn produced: if the worker called `agent-report`, that report text is returned (`{ report, reported: true }`); otherwise it falls back to the worker's last plain-text answer (`{ report, reported: false }`).
4. The planner sees this as a normal tool result. It's the planner's call what happens next — prompt the same worker again to continue (its message history persists across `agent-prompt` calls, same as any agent's `run()`), or move on and never call it again if the report shows the work is done. Nothing about the worker's lifecycle is automatic.

`AgentTools(...)` state (which agents are hired) is scoped to that one call — building a second, independent planner with its own `AgentTools([...])` call gets its own hire state, even in the same process.
