# MCP Architecture

OrbitX's tool execution layer is built around a small client/server protocol (called "MCP" in this codebase — not to be confused with Anthropic's separate Model Context Protocol spec; it's an internal naming choice). It exists to decouple *where tools run* from *where the agent loop runs* — the same `MCPTool` definitions work whether they execute in the same process, in a separate process over a Unix socket / named pipe, over a WebSocket, or inside a sandboxed Docker container.

`SimpleAgent` hides all of this behind an in-process connection. Reach for these primitives directly only when you need one of the other transports.

## The three pieces

```
MCPServer  — owns the registered tools, actually executes them
MCPClient  — what BaseAgent calls; sends tool invocations to a server, returns results
MCPConnection — the transport wiring a client to a server (in-process, IPC, or WS)
```

### `MCPServer`

```ts
new MCPServer(connection: MCPConnection, storage?: MCPStorage, rng?: MCPRNG);
mcpServer.registerTool(tool: MCPTool<any>): void;
```

Registers tools and listens on its `connection` for incoming tool-call requests, executing them and sending results back. Defaults to `MCPFSStorage` (filesystem-backed key/value storage — see below) if no `storage` is given.

### `MCPClient`

```ts
new MCPClient(envID: string, connection: MCPConnection | MCPConnection[], storage?: MCPStorage, rng?: MCPRNG, mcpFilter?: MCPOutputFilter, executionPolicy?: MCPExecutionPolicy);
mcpClient.getTools(): Promise<ToolSchema[]>;
mcpClient.callTool(name: string, inputs: Record<string, any>, toolCallId?: string): Promise<MCPToolOutput>;
mcpClient.setExecuteProviderHandler(handler: (toolCallId: string, type: ProviderType, input: Record<string, any>) => Promise<{ output: Record<string, any> }>): void;
```

`toolCallId` on `callTool()` and the handler installed via `setExecuteProviderHandler()` are what `BaseAgent` wires up automatically so `mcp.executeProvider(...)` works inside a tool's `execute()` — see [Custom `MCP` subclasses](#custom-mcp-subclasses) below. You don't need to call either yourself unless you're driving `MCPClient` outside of `BaseAgent`. A `SwarmBase` takes that handler back after building each agent, so in a swarm the provider call is answered by the swarm — see [Swarm](./swarm.md#providers-a-tool-reaches-for).

This is what you pass into `BaseAgent({ mcpClient, ... })`. `envID` scopes storage/RNG state per logical environment/session — pass a stable id (e.g. a user or conversation id) if you want isolated tool state per agent instance sharing a server. Accepting an array of connections lets one client fan out across multiple servers.

`mcpFilter` (an `MCPOutputFilter`) redacts sensitive substrings/patterns from tool output before it reaches the model — see [`MCPOutputFilter`](#mcpoutputfilter-redacting-tool-output) below.

`executionPolicy` (an `MCPExecutionPolicy`) decides whether a tool call is allowed to run at all, *before* it's dispatched — see [`MCPExecutionPolicy`](#mcpexecutionpolicy-gating-tool-calls) below.

#### Registering tools directly on the client (bypassing the connection)

`MCPClient` also has its own `registerTool(tool: MCPTool<any>)`, separate from `MCPServer.registerTool()`. A tool registered on the client executes locally, on whatever machine/process the client itself is running in — it never crosses the connection to the remote server at all. `callTool()` checks the client's own tool list first, and only falls back to sending the call across the connection if no local match is found; `getTools()` merges both lists the same way (a client-registered tool shadows a same-named server tool).

This matters when you're using `MCPIPCConnection`/`MCPWSConnection`/`MCPComputer` to run most tools inside a separate process or sandbox: routing every single call across that boundary adds latency for tools that don't need the isolation. If a tool is cheap and can't do any harm (e.g. `GetCurrentTimeTool`, a pure computation like the `SumTool` example in [Tools](./tools.md#writing-a-custom-tool)), register it directly on the `MCPClient` instead of the sandboxed `MCPServer` — it still shows up to the model exactly like any other tool, it just answers immediately from the host process instead of round-tripping through IPC/WS/Docker. Keep anything that touches the filesystem, shell, or network on the sandboxed server side, where `MCPComputer`'s isolation actually protects you.

### `MCPConnection` and its variants

- **`MCPConnection`** (base/in-process) — tools run in the same process as the agent. What `SimpleAgent` uses internally; you'd construct one directly only when composing `BaseAgent` by hand (see the README's "Building from the Base Agent" example).
- **`MCPIPCConnection`** — connects client and server across two processes over a named pipe (Windows) or Unix domain socket (`socketPath`), with `mode: "server" | "client"` on each side:

  ```ts
  import os from "os";
  import { MCPIPCConnection } from "orbitx";

  const path = os.platform() === "win32" ? `\\\\.\\pipe\\mcp_test` : `/tmp/mcp_test.sock`;
  const ipcConnection = new MCPIPCConnection({ mode: "server", socketPath: path });
  ```

- **`MCPWSConnection`** — connects over a WebSocket, optionally with a shared `token` for auth and `tls: { key, cert, ca? }` for WSS:

  ```ts
  import { MCPWSConnection } from "orbitx";

  const wsConnection = new MCPWSConnection({ mode: "server", host: "0.0.0.0", port: 9257, token: "1234" });
  ```

  Client-mode options use `url` instead of `host`/`port`. Both IPC and WS auto-reconnect on disconnect (`reconnectDelay`, default 500ms).

## `MCPComputer` — sandboxed execution *(experimental)*

Spins up a Docker container running an MCP server and hands you back a ready-to-use connection — no manual socket/port/token wiring. This is the recommended way to let an agent run filesystem/bash tools without risking the host machine.

```ts
import { MCPComputer } from "orbitx";

const computer = new MCPComputer("/path/to/mount", [3000, 8080]);
await computer.start();

const connection = computer.getConnection();
// ... build MCPClient/MCPServer/BaseAgent around `connection` as usual ...
await computer.stop();
```

```ts
new MCPComputer(mountPath: string, ports: number[] | "*", image?: string, options?: MCPComputerOptions);
```

- `mountPath` — host directory mounted into the container (this is what filesystem tools inside the sandbox actually touch). Four subdirectories are created under it and mounted: `workspace`, `mcp-server-storage`, `presents`, `user-inputs`.
- `ports` — ports to publish from the container, or `"*"` for host network mode. **`"*"` is Linux-only**: on Windows and macOS the container joins a VM's network namespace, so nothing it binds is reachable from your machine and published ports are ignored — the constructor throws rather than letting that surface later as a connection timeout.
- `image` — defaults to `aliafsordeh/orbitx-sandbox:0.2`.
- `start()` — verifies the Docker daemon is reachable, prepares the mount, launches the container, waits for its ready log, and then waits for the connection endpoint to actually accept traffic. It resolves only when the sandbox is genuinely reachable, and rejects with the container's own output when it is not.
- `getConnection(wsHost?)` — returns a ready `MCPConnection`, cached (repeated calls hand back the same object). In `"ws"` mode it must be called after `start()`, since the port is only chosen there.
- `waitUntilConnected(timeoutMs?)` — optional; resolves once the transport is carrying traffic, if you want the MCP handshake up before the first tool call.
- `getPresentsHostPath()`, `getConnectionPort()`, `getContainerName()`, `isRunning()` — host-side accessors.
- `stop()` — removes the container, closes the connection, and cleans up the socket directory. Idempotent.

`MCPComputerOptions`:

| Option | Default | Purpose |
| --- | --- | --- |
| `connectionMode` | `"ipc"` on Linux, `"ws"` elsewhere | Transport between your process and the sandbox. |
| `readyTimeoutMs` | `60_000` | Wait for the sandbox's ready log once the container is running. |
| `pullTimeoutMs` | `300_000` | Inactivity budget while docker pulls the image, so a first run isn't killed mid-download. |
| `handshakeTimeoutMs` | `20_000` | Wait for the endpoint to accept traffic after the ready log. |
| `onLog` | — | `(line, "stdout" \| "stderr") => void`; receives everything the container writes. |
| `dockerBin` | `"docker"` | Override the executable (e.g. `"podman"`, or an absolute path). |

The transport default is not a style choice: Docker Desktop on Windows and macOS runs the daemon inside a VM and shares the mount over a network filesystem, which cannot carry a unix-domain socket. IPC therefore only works when the daemon and your process share a kernel, and WebSocket (loopback-published, with an auto-generated auth token) is used everywhere else.

Requires the `aliafsordeh/orbitx-sandbox:0.2` image (pull it, or build it yourself from the `Dockerfile.sandbox` at the repo root). Note that the sandbox's own stdout/stderr are drained continuously for the life of the container — a piped-but-unread stream fills its OS buffer after ~64KB and blocks the sandbox process on its next write, which surfaces much later as tool calls that never return.

Servers started *inside* the sandbox must bind `0.0.0.0`, not `localhost`, to be reachable through a published port; `getInstructions()` tells agents this.

## Storage and RNG

- **`MCPStorage`** — abstract `{ get(key): Promise<string>; set(key, value): Promise<void> }`. `MCPFSStorage` is the default filesystem-backed implementation (`new MCPFSStorage(path?)`, defaults to a randomly-named folder under the OS temp directory). `MCPStorage` and `MCPFSStorage` are both exported if you want to implement your own backend (Redis, a database, etc.) or point the default one at a specific path.
- **`MCPRNG`** — deterministic-ish id generator backed by an `MCPStorage` instance (used internally for things like `generateRefId()`, the helper behind ref ids in `BrowserReadTool`'s output).

## `MCPOutputFilter` — redacting tool output

```ts
new MCPOutputFilter(values: (string | RegExp)[]);
mcpFilter.filter(input: any): any;   // replaces every match with "FILTERED_OUTPUT"
```

Pass literal strings (e.g. an API key you never want echoed back to the model) or regexes (e.g. `/sk-[a-zA-Z0-9]{20,}/`) as the `mcpFilter` argument to `MCPClient` to scrub tool output before it's returned — useful when a tool might read a file or environment variable containing a secret.

> `MCPOutputFilter` was named `MCPFilter` before. The old name is still exported as a deprecated alias (`export const MCPFilter = MCPOutputFilter`) and will be removed in `1.0.0` — switch to `MCPOutputFilter` in new code.

## `MCPExecutionPolicy` — gating tool calls

```ts
abstract class MCPExecutionPolicy {
    abstract authorize(request: MCPToolCallRequest): Promise<boolean> | boolean;
}
// MCPToolCallRequest = { toolName: string; inputs: Record<string, any>; envID: string; toolCallId?: string };
```

Checked by `MCPClient.callTool()` before every tool call is dispatched — whether the tool is registered locally on the client or routed across a connection to a remote `MCPServer`. Returning (or resolving to) `false` throws before the call reaches the tool, and that error surfaces to the model as a normal tool-error result (`BaseAgent`'s dispatch loop catches it the same way it catches any other `callTool()` rejection).

`MCPClient` defaults to `MCPBypassExecutionPolicy`, a built-in no-op that authorizes every call — so this is entirely opt-in. Implement your own subclass of `MCPExecutionPolicy` to add an allowlist, rate limiting, per-tool confirmation, or any other trust policy, and pass it as the `executionPolicy` argument to `MCPClient`'s constructor:

```ts
import { MCPClient, MCPExecutionPolicy, type MCPToolCallRequest } from "orbitx";

class AllowlistPolicy extends MCPExecutionPolicy {
    #allowed: Set<string>;
    constructor(allowed: string[]) {
        super();
        this.#allowed = new Set(allowed);
    }
    authorize({ toolName }: MCPToolCallRequest) {
        return this.#allowed.has(toolName);
    }
}

const mcpClient = new MCPClient(envID, connection, storage, rng, undefined, new AllowlistPolicy(["get_current_time"]));
```

### `MCPAutoExecutionPolicy` — an AI-judged policy

`MCPAutoExecutionPolicy` (`src/core/mcp-auto-execution-policy.ts`) is a built-in `MCPExecutionPolicy` that asks a model, via [`AIASK`](./agents.md#aiask), whether each call is safe — an alternative to a hand-written allowlist/denylist for cases where "safe" isn't a fixed rule. It's built to keep the expensive part (an actual model call) as rare as possible rather than reviewing every single tool call:

```ts
new MCPAutoExecutionPolicy({
  aiModel: AIProvider | AgentProviderEntry[];
  instruction?: string;   // extra context appended after the built-in default instruction — e.g. what the user actually asked the agent to do
  onVerdict?: (request: MCPToolCallRequest, verdict: { harmful: boolean; reason: string }) => void;
  watchedTools?: string[];   // default: ["bash-run", "fs-write-file", "fs-edit-file", "fs-delete", "fs-move"]
  scopeDir?: string;         // default: process.cwd() at construction time
});
```

Three cost-cutting layers, checked in order inside `authorize(request)`:

1. **Not in `watchedTools`?** Authorized immediately — no model call, no verdict recorded at all. Most tools (`get-current-time`, `todo-*`, `fs-read-file`, ...) have nothing dangerous to weigh, so the default watch list is only the destructive/execution tools: `bash-run` and the fs tools that write, edit, delete, or move something. Pass your own `watchedTools` to widen or narrow that set.
2. **A watched *fs* call whose path(s) all resolve inside `scopeDir`?** Also authorized immediately, no model call — a write/edit/delete confined to the expected working directory doesn't need judgment. Paths are resolved the same way the fs tools themselves resolve them (relative to `process.cwd()`); `fs-move` needs *both* `from` and `to` inside scope to skip the model — one path escaping scope is enough to escalate. `bash-run` has no path field to check here, so it always falls through to the model.
3. **Otherwise, ask the model** — via `AIASK`, on `{ toolName, inputs }`. `authorize()` denies whenever the verdict comes back `harmful: true`, or whenever `AIASK` itself couldn't reach a valid verdict after its own retries (fails closed, not open).

Whenever a call *does* reach the model, file content is stripped out first — `fs-write-file`/`fs-edit-file`'s `content` field is replaced with `<omitted, N bytes>` before it's ever sent, since the file's contents aren't relevant to judging whether the *call* is safe, and including it would make every write/edit review needlessly expensive. The model judges those calls by path and other inputs alone.

`authorize()`'s boolean return only tells `MCPClient` whether to proceed — it doesn't surface *why* a call was judged (or skipped as) harmful/safe, which callers usually want (to log it, or show the user what got blocked). Three ways to get that — all populated for both a model-reviewed call and one that was authorized locally via the path-scope check, but never for a call outside `watchedTools`, which is never reviewed at all:

- `policy.getVerdict(toolCallId)` — the verdict recorded for one specific call, if it carried a `toolCallId`.
- `policy.getLastVerdict()` — the most recent verdict of any reviewed call, useful when only one policy instance is ever in flight at a time.
- `onVerdict` — called synchronously right after every reviewed `authorize()` decision, with both the request and the verdict.

```ts
const policy = new MCPAutoExecutionPolicy({
  aiModel,
  scopeDir: "/home/me/project",   // writes/edits/deletes/moves confined here skip the model entirely
  onVerdict: (request, verdict) => {
    if (verdict.harmful) console.warn(`blocked ${request.toolName}: ${verdict.reason}`);
  },
});

const mcpClient = new MCPClient(envID, connection, storage, rng, undefined, policy);
```

Even with those shortcuts, a call that does reach the model costs at least one real call (more if `AIASK`'s own retry loop kicks in — see [`AIASK`](./agents.md#aiask)) — this still trades latency/cost for judgment a fixed rule can't express, just as rarely as the watch list and scope check allow. Reach for a plain `MCPExecutionPolicy` subclass first when a simple allowlist/denylist actually covers the case.

## Custom `MCP` subclasses

Both `MCPServer` and `MCPClient` extend the abstract `MCP` class — `getStorage()`, `getRNG()`, and `executeProvider(toolCallId, type, input)`. Tool `execute` functions receive the calling `MCP` instance directly, as their 4th argument (after a `toolCallId` — see [Tools](./tools.md#the-mcptool-shape)), so a tool can reach storage/RNG scoped to whichever client dispatched the call.

`executeProvider` is where the two subclasses genuinely differ:

- **`MCPClient`** answers it in-process, by delegating to a handler `BaseAgent` installs on the client via `setExecuteProviderHandler(...)` at construction time. `MCPClient` itself never imports anything from `ai-provider.ts` — it just holds an opaque callback.
- **`MCPServer`** has no such handler — it never touches a provider directly. It proxies the request over its `MCPConnection` (an `executeProvider`/`executeProviderResponse` message pair, mirroring `toolCall`/`toolCallCallback` but initiated by the server instead of the client) to whichever `MCPClient` is attached, which runs the same installed handler and answers back.

So a **server-registered** tool — the kind meant to run inside `MCPComputer`'s sandbox, or in a genuinely separate process over IPC/WS — can still call `mcp.executeProvider(...)` and get a real result, without a provider instance (or the credentials it holds) ever crossing into that process. Only a scoped request/response for one call does. This is deliberate: filesystem/browser-touching tools like `ReadImageTool`/`BrowserScreenshotTool` are exactly the kind this doc already recommends sandboxing (see above), and they both need a provider to do their job.

That accessor also carries provider access (`agent.getProvider(type)`/`getProviders(type)`) — but **only for a tool dispatched by `MCPClient.callTool`'s local branch** (a tool registered directly on the client, per the section above). `MCPServer`'s dispatch (both the `toolCall` handler above and, transitively, anything a remote/sandboxed tool triggers) builds an accessor with no provider registry behind it at all, so `getProvider`/`getProviders` there always resolve `undefined`. This is deliberate, not a gap to work around: provider instances hold API keys, and `MCPServer` is precisely the thing that runs inside a separate process or an `MCPComputer` sandbox — credentials never need to, and never do, cross that boundary. A tool that needs to call a provider directly (e.g. to describe an image it just read) has to be registered on the `MCPClient`, in the same process as the agent that owns those providers.
