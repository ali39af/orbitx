# Tools

## The `MCPTool` shape

Every tool — built-in or custom — is an `MCPTool` instance (`src/core/mcp.ts`):

```ts
new MCPTool({
  name: string;
  description: string;
  inputs: {
    name: string;
    type: "number" | "string" | "boolean" | "object" | "array";
    description: string;
    required?: boolean;
    default?: any;
  }[];
  stopIterationAfterUsingThisTool?: boolean;   // default false
  execute: (
    envID: string,
    inputs: Record<string, any>,
    toolCallId?: string,
    mcp?: MCP
  ) => Promise<any>;
});
```

- `inputs` doubles as both the JSON-schema-like description sent to the model (translated per-provider by `src/core/tool-schema-translator.ts`) and the shape `execute` should expect on `inputs`.
- `stopIterationAfterUsingThisTool: true` ends the agent's run loop immediately after this tool fires, even if the model didn't naturally stop calling tools — useful for a "final answer" or "hand off" style tool.
- `execute`'s return value is normalized via `normalizeToolOutput()` into `{ output: {...} }` — return a plain object (or anything else) and it becomes `output` as-is, same convention as always.
- `envID` identifies which "environment" (in-process client id, IPC/WS session) the call came from — most tools ignore it unless they need per-environment isolated state (see `MCPStorage`/`MCPFSStorage` in [MCP Architecture](./mcp-architecture.md)).
- `toolCallId` is this specific call's id, needed only by a tool that calls `mcp.executeProvider(...)` (see below) — everything else can ignore it.

### `mcp.executeProvider(...)` — calling a provider from inside a tool

`MCP` (what `execute`'s 4th argument gives you, same as it always has) has one method beyond `getStorage()`/`getRNG()`:

```ts
abstract class MCP {
  getStorage(): MCPStorage;
  getRNG(): MCPRNG;
  executeProvider(toolCallId: string, type: ProviderType, input: Record<string, any>): Promise<{ output: Record<string, any> }>;
}
```

`type` picks a role (see [Provider roles](./providers.md#provider-roles)); `input` must be `Message`-shaped — `{ content: string }` for plain text, or `{ parts: MessageContentPart[] }` when real multimodal content (an image, say) needs to reach the provider. `BaseAgent#executeProvider` spreads `input` straight onto the outgoing `role: "user"` message (no `safetyPolicies` system message here, unlike the main run loop — see [Guardrail system prompt](./agents.md#guardrail-system-prompt)) and stays completely type-agnostic itself — it never branches on `type`, so a role that needs `parts` (`image-describer`) and one that only needs `content` (a plain text-generation role) go through the exact same code path. Shaping `input` correctly is the calling tool's job: **use `parts`, not a `data:` URI folded into `content`, for images/video** — every built-in provider (Anthropic/OpenAI/DeepSeek/Ollama) only builds a real multimodal content block from `Message.parts`; a base64 string inside `content` is sent to the model as literal text, not an image. This works identically no matter where the tool is registered — directly on an `MCPClient`, or on a sandboxed/remote `MCPServer` (see [MCP Architecture](./mcp-architecture.md#custom-mcp-subclasses)) — because the actual provider call always happens on the trusted side (wherever `BaseAgent` lives): a client-registered tool reaches it in-process, a server-registered one has the request proxied there over the existing connection and back. No provider instance, or the credentials it holds, is ever visible to the tool — only this request/response.

**Off by default.** `executeProvider` throws immediately unless the owning `BaseAgent` was constructed with `features: { executeProviderFromMCPTool: true }` (see [`executeProvider` feature flag](./agents.md#executeprovider-feature-flag)) — a tool reaching a provider directly, with no guardrail prompt ahead of it, is a bigger trust surface than one that only returns data to the model, so it needs an explicit opt-in from whoever builds the agent.

`read-image`/`browser-screenshot` (below) are the reference example — the instruction as a `text` part, the base64 image as an `image` part:

```ts
const { output } = await mcp.executeProvider(toolCallId, "image-describer", {
  parts: [
    { type: "text", text: instruction },
    { type: "image", image, mimeType },
  ],
});
return { description: output.content }; // output.content: string
```

If `executeProvider` rejects (no provider configured for that role, etc.), just let it throw — `BaseAgent`'s existing `execute()` error handling turns it into a normal `Error: ...` tool result, no special handling needed.

### Usage is never something a tool reports itself

There's no `usage` field on what `execute` returns. Every `executeProvider` call is recorded by `BaseAgent` the instant the real provider call resolves — keyed by `toolCallId`, moved onto the tool's result `Message.usage` only after `execute()` returns (see [Token accounting](./agents.md#token-accounting)) — specifically so a compromised or rewritten tool can't just under-report what it spent; it never holds that number to begin with.

Tools are registered on an `MCPServer` and invoked through an `MCPClient`; `SimpleAgent` does this wiring for you from a flat `tools` array.

One tool schema the model sees isn't an `MCPTool` at all: `BaseAgent` always appends a built-in `compact_memory` tool to the schema list, handled internally rather than routed through the `MCPClient`. See [Memory compaction](./agents.md#memory-compaction).

## Built-in tool catalog

Import a whole domain's tools at once (e.g. `FsTools()`), or import individual tools by name.

### Filesystem — `FsTools()`

> ⚠️ `FsWriteFileTool` and `FsDeleteTool` can permanently overwrite, delete, or corrupt existing files — no undo. Prefer routing filesystem access through `MCPComputer`'s sandbox (see [MCP Architecture](./mcp-architecture.md#mcpcomputer-sandboxed-execution)) to protect the host system, and/or gate these tools behind an `MCPExecutionPolicy` (see [`MCPExecutionPolicy`](./mcp-architecture.md#mcpexecutionpolicy-gating-tool-calls)) — e.g. denying `fs-write-file`/`fs-delete` outside an allowlisted directory, or requiring per-call confirmation.

| Tool | Purpose |
|---|---|
| `FsReadFileTool` | Read a text file, paging through large files by line. |
| `FsWriteFileTool` | Write/overwrite a file's full content (creates parent dirs as needed). ⚠️ No undo. |
| `FsEditFileTool` | Replace a specific line range in an existing file without rewriting the whole thing. |
| `FsListDirTool` | List a directory's entries, paged by index for large directories. |
| `FsCreateDirTool` | Create a directory, including missing parents. |
| `FsDeleteTool` | Permanently delete a file or directory (recursive optional). ⚠️ No undo. |
| `FsMoveTool` | Move or rename a file or directory. |

`FsReadFileTool` and `FsEditFileTool` both use **1-indexed** line numbers (line 1 is the first line of the file) for their `offsetLine` input — matching the convention most models already default to (`cat -n`, most editors). This is deliberate: a line number reported by `fs-read-file`'s `startLine`/`endLine` can be passed straight into `fs-edit-file`'s `offsetLine` without an off-by-one conversion. `limitLine` on both is a plain count, not a line number, so it isn't affected by the indexing.
| `FsStatTool` | Check whether a path exists and get its metadata (type, size, modified time). |

### Bash / processes — `BashTools()`

> ⚠️ Shell commands can permanently delete files, corrupt data, modify system settings, or execute harmful operations — no undo. Same sandboxing recommendation as above, and the same `MCPExecutionPolicy` option — e.g. denying `bash-run` calls whose command matches a deny-list, or routing them through a human-confirmation policy.

| Tool | Purpose |
|---|---|
| `BashRunTool` | Launch a shell command as a background process; returns immediately if it's still running after `waitMs` (e.g. a dev server). |
| `BashWaitTool` | Wait again on a previously started process and get its latest status/output. |
| `BashLogsTool` | Read a process's combined stdout/stderr, paged by line. |
| `BashListTool` | List every process launched so far with its status. |
| `BashWriteInputTool` | Send text to a running process's stdin (answer an interactive prompt like `(y/n)`). |
| `BashTerminateTool` | Terminate a running process. |

### Browser — `BrowserTools()`

Drives a real headless browser session.

| Tool | Purpose |
|---|---|
| `BrowserCreateSessionTool` | Open a new headless browser session at a URL, returns its `sessionId`. |
| `BrowserRemoveSessionTool` | Close and remove a browser session. |
| `BrowserGetSessionsTool` | List all currently open session ids. |
| `BrowserNavigateTool` | Navigate an existing session to a new URL. |
| `BrowserReadTool` | Read the page as a text outline (headings, tables, links, forms), assigning ref ids to clickable/fillable elements. |
| `BrowserClickTool` | Click a `[CLICKABLE]` element by ref id. |
| `BrowserFillTool` | Type into a `[FILLABLE]` element by ref id; can submit via Enter if the field's form has no visible submit button. |
| `BrowserSubmitFormTool` | Submit a `[FORM]` ref directly — for forms with no visible submit button. |
| `BrowserScrollInfoTool` | Get total scrollable length and current scroll position. |
| `BrowserScrollTool` | Scroll to a given vertical pixel position. |
| `BrowserConsoleTool` | Read captured browser console log messages. |
| `BrowserNetworkTool` | Read captured network request/response activity. |
| `BrowserNetworkStatusTool` | Check whether the page currently has in-flight network activity. |
| `BrowserInjectTool` | Evaluate arbitrary JS in the page and return the result. |
| `BrowserScreenshotTool` | Capture a screenshot and return a text description of it (via an `image-describer` provider — see [Provider roles](./providers.md#provider-roles)). |

### Todo lists — `TodoTools()`

Backs the `PlannerSkill` (see [Skills](./skills.md)), but usable standalone.

| Tool | Purpose |
|---|---|
| `TodoCreateListTool` | Create a new todo list, returns its `todoListId`. |
| `TodoRemoveListTool` | Remove one or more todo lists (and their tasks). |
| `TodoGetListsTool` | Get all existing todo list ids. |
| `TodoGetListTool` | Get all tasks belonging to a list. |
| `TodoCreateTaskTool` | Create one or more tasks inside a list. |
| `TodoRemoveTaskTool` | Remove one or more tasks by id. |
| `TodoCheckTaskTool` | Set the checked/unchecked state of one or more tasks. |

### Present / deliverables — `PresentTools()`

| Tool | Purpose |
|---|---|
| `PresentAddTool` | Present a file to the user by copying it into the present folder (zip folders first — this only accepts single files). |
| `PresentClearTool` | Clear out every file currently presented. |
| `PresentGetListTool` | Get the list of files currently presented. |

### Question / answer — `QuestionAnswerTools()`

| Tool | Purpose |
|---|---|
| `QuestionAnswerTool` | Ask the human operator a clarifying question and wait for their answer. |

### Utility — `UtilTools()`

| Tool | Purpose |
|---|---|
| `GetCurrentTimeTool` | Get the current date/time (ISO string, unix timestamp, timezone). |
| `DelayTool` | Wait a given number of milliseconds (max 60000ms) before continuing. |
| `ReadImageTool` | Read an image file off disk and return a text description of it — same handling as `BrowserScreenshotTool`. |

### Multi-agent — `AgentTools(availableAgents, options?)` *(experimental)*

**Experimental** — see the note in [Agents](./agents.md#multi-agent-workeragent-experimental).

Unlike every other domain above, this one takes parameters: a fixed roster of `WorkerAgent` instances (see [Agents](./agents.md#multi-agent-workeragent-experimental)) you build ahead of time, and an optional `{ maxHired?: number }` cap on how many can be hired at once. Give the result to your **planner** agent.

| Tool | Purpose |
|---|---|
| `agent-list` | List every worker in the roster — name, description, rating, and hired status. Also returns `hiredCount` and (when set) `maxHired`. |
| `agent-hire` | Hire a worker by name, making it eligible for `agent-prompt`. |
| `agent-prompt` | Send a prompt to a hired worker and return its response once it's done. |

`AgentReportTool` is a separate, standalone factory in the same module — put it on each **worker's own** tool list instead (not the planner's), so a worker can hand a result back and end its turn. See [Agents](./agents.md#agent-report--for-workers-not-the-planner) for the full walkthrough.

## Writing a custom tool

```ts
import { MCPTool } from "orbitx";

export const SumTool = () => new MCPTool({
  name: "math-sum",
  description: "get two numbers and sum them",
  inputs: [
    { name: "first", type: "number", description: "first number", required: true },
    { name: "second", type: "number", description: "second number", required: true },
  ],
  execute: async (_envID: string, inputs: Record<string, any>) => {
    const { first, second } = inputs;
    if (typeof first !== "number") throw new Error("first must be a number");
    if (typeof second !== "number") throw new Error("second must be a number");
    return { output: first + second };
  },
});
```

Use it exactly like a built-in tool:

```ts
const agent = new SimpleAgent({
  aiProvider: provider,
  instruction: "You are a helpful assistant.",
  tools: [SumTool()],
});
```

Conventions worth following, based on the built-in tools:
- Export a **factory function** (`SumTool()`), not the `MCPTool` instance itself — this keeps each agent's tool list made of fresh instances.
- Throw inside `execute` for invalid input rather than returning an error object — thrown errors are caught by `BaseAgent` and turned into a `Error: ...` result the model sees, which is usually what you want.
- Keep `description` and each input's `description` written for the model, not for a human reader of your source — they go straight into the tool schema.
