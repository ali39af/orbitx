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
new MCPClient(envID: string, connection: MCPConnection | MCPConnection[], storage?: MCPStorage, rng?: MCPRNG, mcpFilter?: MCPFilter);
mcpClient.getTools(): Promise<ToolSchema[]>;
mcpClient.callTool(name: string, inputs: Record<string, any>): Promise<MCPToolOutput>;
```

This is what you pass into `BaseAgent({ mcpClient, ... })`. `envID` scopes storage/RNG state per logical environment/session — pass a stable id (e.g. a user or conversation id) if you want isolated tool state per agent instance sharing a server. Accepting an array of connections lets one client fan out across multiple servers.

`mcpFilter` (an `MCPFilter`) redacts sensitive substrings/patterns from tool output before it reaches the model — see [`MCPFilter`](#mcpfilter-redacting-tool-output) below.

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

- `mountPath` — host directory mounted into the container (this is what filesystem tools inside the sandbox actually touch).
- `ports` — ports to expose from the container, or `"*"` for host network mode (Linux only, or Windows via WSL2).
- `getConnection()` — returns a ready `MCPConnection`: IPC on Linux/macOS, WebSocket on Windows (auth token generated automatically).
- `stop()` — kills the container.

Requires the `aliafsordeh/orbitx-sandbox:0.1` image (pull it, or build it yourself from the `Dockerfile.sandbox` at the repo root).

## Storage and RNG

- **`MCPStorage`** — abstract `{ get(key): Promise<string>; set(key, value): Promise<void> }`. `MCPFSStorage` is the default filesystem-backed implementation (`new MCPFSStorage(path?)`, defaults to a randomly-named folder under `./data`). `MCPStorage` and `MCPFSStorage` are both exported if you want to implement your own backend (Redis, a database, etc.) or point the default one at a specific path.
- **`MCPRNG`** — deterministic-ish id generator backed by an `MCPStorage` instance (used internally for things like `generateRefId()`, the helper behind ref ids in `BrowserReadTool`'s output).

## `MCPFilter` — redacting tool output

```ts
new MCPFilter(values: (string | RegExp)[]);
mcpFilter.filter(input: any): any;   // replaces every match with "FILTERED_OUTPUT"
```

Pass literal strings (e.g. an API key you never want echoed back to the model) or regexes (e.g. `/sk-[a-zA-Z0-9]{20,}/`) as the `mcpFilter` argument to `MCPClient` to scrub tool output before it's returned — useful when a tool might read a file or environment variable containing a secret.

## Custom `MCP` subclasses

Both `MCPServer` and `MCPClient` extend the abstract `MCP` class (`getStorage()`, `getRNG()`). Tool `execute` functions receive the calling `MCP` instance as their third argument, so a custom `MCPCustomClass`-based tool (see [Tools](./tools.md#the-mcptool-shape)) can reach storage/RNG scoped to whichever client dispatched the call.
