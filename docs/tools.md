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
  customClass?: MCPCustomClass;                // optional stateful helper, see below
  execute: (
    envID: string,
    inputs: Record<string, any>,
    mcp?: MCP,
    customClass?: typeof customClass
  ) => Promise<any>;
});
```

- `inputs` doubles as both the JSON-schema-like description sent to the model (translated per-provider by `src/core/tool-schema-translator.ts`) and the shape `execute` should expect on `inputs`.
- `stopIterationAfterUsingThisTool: true` ends the agent's run loop immediately after this tool fires, even if the model didn't naturally stop calling tools — useful for a "final answer" or "hand off" style tool.
- `execute`'s return value is normalized via `normalizeToolOutput()` into either `{ type: "text", output: {...} }` or `{ type: "image", output: { image, mimeType, ... } }`. Return `{ type: "image", output: {...} }` explicitly to hand back an image (it gets routed through the agent's image provider — see [Providers](./providers.md#two-provider-roles-main--image)); anything else is treated as a plain JSON text result.
- `envID` identifies which "environment" (in-process client id, IPC/WS session) the call came from — most tools ignore it unless they need per-environment isolated state (see `MCPStorage`/`MCPFSStorage` in [MCP Architecture](./mcp-architecture.md)).
- `customClass` (a subclass of `MCPCustomClass`) is a way to give a tool its own persistent helper object with access to the owning `MCP` instance (`getMCP()`) and an `EventEmitter` (`getEvents()`) for progress/status events — see how the built-in `*Interaction` classes are used (e.g. `FsInteraction`, `BrowserInteraction`) if you want to expose live progress to a UI. **Experimental:** `customClass` is still settling — its name and shape may change (or it may be removed) in a future release, so avoid depending on it for anything beyond the built-in `*Interaction` pattern until it stabilizes.

Tools are registered on an `MCPServer` and invoked through an `MCPClient`; `SimpleAgent` does this wiring for you from a flat `tools` array.

## Built-in tool catalog

Import a whole domain's tools at once (e.g. `FsTools()`), or import individual tools by name. Every domain also exports a `*Interaction` `EventEmitter` for subscribing to that domain's live progress events (e.g. `FsInteraction`, `BashInteraction`).

### Filesystem — `FsTools()`

> ⚠️ `FsWriteFileTool` and `FsDeleteTool` can permanently overwrite, delete, or corrupt existing files — no undo. Prefer routing filesystem access through `MCPComputer`'s sandbox (see [MCP Architecture](./mcp-architecture.md#mcpcomputer-sandboxed-execution)) to protect the host system.

| Tool | Purpose |
|---|---|
| `FsReadFileTool` | Read a text file, paging through large files by line. |
| `FsWriteFileTool` | Write/overwrite a file's full content (creates parent dirs as needed). ⚠️ No undo. |
| `FsEditFileTool` | Replace a specific line range in an existing file without rewriting the whole thing. |
| `FsListDirTool` | List a directory's entries, paged by index for large directories. |
| `FsCreateDirTool` | Create a directory, including missing parents. |
| `FsDeleteTool` | Permanently delete a file or directory (recursive optional). ⚠️ No undo. |
| `FsMoveTool` | Move or rename a file or directory. |
| `FsStatTool` | Check whether a path exists and get its metadata (type, size, modified time). |

### Bash / processes — `BashTools()`

> ⚠️ Shell commands can permanently delete files, corrupt data, modify system settings, or execute harmful operations — no undo. Same sandboxing recommendation as above.

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
| `BrowserScreenshotTool` | Capture a screenshot; can be described by the `image` provider instead of passed raw to the main model. |

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
