[![OrbitX Logo](https://raw.githubusercontent.com/ali39af/orbitx/refs/heads/main/orbitx.svg)](#)

## Installation

```bash
npm install orbitx
```

## Quick Start

The fastest way to get an agent running is `SimpleAgent` — give it a provider, an instruction, and a list of tools/skills.

```ts
import { OllamaProvider, SimpleAgent, GetCurrentTimeTool } from "orbitx";

const ollamaProvider = new OllamaProvider("gemma3:latest");

const agent = new SimpleAgent({
  aiProvider: ollamaProvider,
  instruction: "You are a helpful assistant.",
  tools: [GetCurrentTimeTool()],
});

let oldRole: "assistant" | "tool" | undefined;

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

All tools and skills passed in are baked into the system prompt once, up front — there's no separate routing/selection step deciding what the model can see turn to turn.

### Recovering an agent's state

`getCurrentAgentStates()` returns a plain JSON-serializable snapshot (messages, memory, token counters). Save it wherever you like, and pass it back in as `initData` to resume the exact same agent later — a process restart, a saved session, etc.

```ts
import { writeFileSync, existsSync, readFileSync } from "fs";

const initData = existsSync("./state.json")
  ? JSON.parse(readFileSync("./state.json", "utf-8"))
  : undefined;

const agent = new SimpleAgent({
  aiProvider: ollamaProvider,
  instruction: "You are a helpful assistant.",
  tools: [GetCurrentTimeTool()],
  ...(initData ? { initData } : {}),
});

// after any run() call:
writeFileSync("./state.json", JSON.stringify(agent.getCurrentAgentStates()));
```

Old messages are never rewritten once written — the agent only ever appends. When the conversation grows past its memory limit, OrbitX keeps the full history intact on disk (`messagesFull`) and instead resets the model's working context window from a running summary of what it already did, so it can keep going indefinitely without losing the ability to act on what happened earlier.

## Providers

OrbitX ships with pluggable AI providers so you can swap models without changing your agent logic.

### Ollama

```ts
import { OllamaProvider } from "orbitx";

const ollamaProvider = new OllamaProvider("gemma3:latest");
```

### DeepSeek

```ts
import { DeepSeekProvider } from "orbitx";

const deepseekProvider = new DeepSeekProvider("api-key", "deepseek-v4-flash");
```

### Anthropic

```ts
import { AnthropicProvider } from "orbitx";

const anthropicProvider = new AnthropicProvider("api-key", "claude-sonnet-5");
```

### OpenAI

```ts
import { OpenAIProvider } from "orbitx";

const openaiProvider = new OpenAIProvider("api-key", "gpt-5");
```

### Two providers: main + image

An agent uses exactly two provider roles — `main` (drives the agent loop itself) and `image` (describes image tool output, e.g. screenshots, so the main conversation doesn't have to carry raw image bytes). Pass a single provider to use it for both roles, or an array to split them:

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

## Available Tools

Tools are grouped by domain. Import each group's array (e.g. `FsTools()`) to get every tool in that group at once, or import individual tools by name.

### Filesystem (`FsTools`)

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

### Bash / processes (`BashTools`)

| Tool | Purpose |
|---|---|
| `BashRunTool` | Launch a shell command as a background process; returns immediately if it's still running after `waitMs` (e.g. a dev server). |
| `BashWaitTool` | Wait again on a previously started process and get its latest status/output. |
| `BashLogsTool` | Read a process's combined stdout/stderr, paged by line. |
| `BashListTool` | List every process launched so far with its status. |
| `BashWriteInputTool` | Send text to a running process's stdin (answer an interactive prompt like `(y/n)`). |
| `BashTerminateTool` | Terminate a running process. |

### Browser (`BrowserTools`)

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
| `BrowserNetworkStatusTool` | Check whether the page currently has in-flight network activity (use before assuming a "no response yet" state means something broke). |
| `BrowserInjectTool` | Evaluate arbitrary JS in the page and return the result. |
| `BrowserScreenshotTool` | Capture a screenshot; can be described by the `image` provider instead of passed raw to the main model. |

### Todo lists (`TodoTools`)

| Tool | Purpose |
|---|---|
| `TodoCreateListTool` | Create a new todo list, returns its `todoListId`. |
| `TodoRemoveListTool` | Remove one or more todo lists (and their tasks). |
| `TodoGetListsTool` | Get all existing todo list ids. |
| `TodoGetListTool` | Get all tasks belonging to a list. |
| `TodoCreateTaskTool` | Create one or more tasks inside a list. |
| `TodoRemoveTaskTool` | Remove one or more tasks by id. |
| `TodoCheckTaskTool` | Set the checked/unchecked state of one or more tasks. |

### Present / deliverables (`PresentTools`)

| Tool | Purpose |
|---|---|
| `PresentAddTool` | Present a file to the user by copying it into the present folder (zip folders first — this only accepts single files). |
| `PresentClearTool` | Clear out every file currently presented. |
| `PresentGetListTool` | Get the list of files currently presented. |

### Utility (`UtilTools`)

| Tool | Purpose |
|---|---|
| `GetCurrentTimeTool` | Get the current date/time (ISO string, unix timestamp, timezone). |
| `DelayTool` | Wait a given number of milliseconds (max 60000ms) before continuing. |

## Available Skills

A `Skill` bundles instructions with the tools that go with them. Passing a skill into an agent adds its tools automatically and folds its instructions into the system prompt.

| Skill | Purpose |
|---|---|
| `PlannerSkill` | Stands up a persistent, checkable todo list for any large/multi-step/vague job so progress survives long conversations and context resets. |
| `BigTaskSkill` | Keeps the agent from stopping short on large or ambitious jobs — no declaring victory on a partial slice, no handing a big job back half-finished. |
| `LongTaskEfficiencySkill` | Keeps a long job efficient — batching, avoiding redundant reads, checkpointing, not gold-plating — without giving up on getting through the full scope. |
| `NodeBackendSkill` | Building, running, and debugging Node.js backends: APIs, servers, CLIs, workers, schedulers, DB access layers — new or existing. |
| `ReactFrontendSkill` | Building, running, and debugging modern React (`.tsx`/`.jsx`) projects, typically Vite-scaffolded — new or existing. |
| `UiUxDesignSkill` | Visual and interaction design quality for any user-facing UI — layout, hierarchy, feedback states, accessibility, responsiveness. |
| `BackendSecuritySkill` | Hardening server-side code that touches auth, sessions, tokens, uploads, DB queries, payments, or any trust boundary. |
| `CodeVerificationSkill` | Running the right type checker/build/lint/test suite before handing code back, and telling real bugs apart from sandbox artifacts. |
| `WebEndToEndTestSkill` | Testing a live web app like a real user would (fill, click, navigate) and verifying via the rendered page, console, and network — not by reading source and assuming. |
| `ResearchSkill` | Answering questions that need real, current information from the live web — opens pages, cross-checks multiple sources, never trusts one page. |
| `ShoppingSkill` | Purchase-decision help — real current listings, prices, links, and review sentiment instead of recommending from memory. |
| `PresentSkill` | Deciding how to hand back a job's output as files (individually or zipped) and cleaning build artifacts out first. |

## Building from the Base Agent

For full control over the MCP server, connection, and client, compose an agent from the base primitives:

```ts
import {
  OllamaProvider,
  MCPConnection,
  MCPServer,
  MCPClient,
  BaseAgent,
  GetCurrentTimeTool,
} from "orbitx";

const ollamaProvider = new OllamaProvider("gemma3:latest");

const connection = new MCPConnection();

const mcpServer = new MCPServer(connection);
mcpServer.registerTool(GetCurrentTimeTool());

const mcpClient = new MCPClient("DEFAULT_ENV", connection);

const agent = new BaseAgent({
  aiProvider: ollamaProvider,
  instruction: "",
  mcpClient,
  allowedTools: [GetCurrentTimeTool()],
});

let oldRole: "assistant" | "tool" | undefined;

agent.run("what is current time?", (chunk) => {
  if (oldRole !== chunk.role) {
    process.stdout.write(`\n${chunk.role}: `);
    oldRole = chunk.role;
  }
  process.stdout.write(chunk.content);
  if (chunk.done) {
    process.stdout.write("\n\n");
    oldRole = undefined;
  }
});
```

### IPC Connections

Run your MCP server as a separate process and connect to it over an inter-process communication (IPC) channel:

```ts
import os from "os";
import { MCPIPCConnection } from "orbitx";

const path =
  os.platform() === "win32" ? `\\\\.\\pipe\\mcp_test` : `/tmp/mcp_test.sock`;

const ipcConnection = new MCPIPCConnection(path);
```

## Creating a Custom Tool

Define your own tools with `MCPTool` to extend an agent's capabilities and integrate with your own ecosystem.

⚠️ EXTREMELY IMPORTANT WARNING ABOUT `FsWriteFileTool` / `FsDeleteTool` ⚠️

🔴 CRITICAL: USE FILE-WRITING/DELETING TOOLS WITH EXTREME CAUTION – THEY CAN PERMANENTLY OVERWRITE, DELETE, OR CORRUPT EXISTING FILES ON YOUR SYSTEM WITHOUT UNDO CAPABILITY.

```ts
import { MCPTool } from "orbitx";

export const SumTool = () => new MCPTool({
  name: "math-sum",
  description: "get two numbers and sum them",
  inputs: [
    {
      name: "first",
      type: "number",
      description: "first number",
      required: true,
    },
    {
      name: "second",
      type: "number",
      description: "second number",
      required: true,
    },
  ],
  execute: async (_envID: string, inputs: Record<string, any>) => {
    const { first, second } = inputs;

    if (typeof first !== "number") {
      throw new Error("first must be a number");
    }
    if (typeof second !== "number") {
      throw new Error("second must be a number");
    }

    return { output: first + second };
  },
});
```

Use it like any built-in tool:

```ts
const agent = new SimpleAgent({
  aiProvider: ollamaProvider,
  instruction: "You are a helpful assistant.",
  tools: [SumTool()],
});
```

## Creating a Custom Skill

A `Skill` bundles instructions with the tools it needs, so an agent that includes it automatically gets both.

```ts
import { Skill, FsReadFileTool, FsWriteFileTool } from "orbitx";
import { SumTool } from "./sum-tool.js";

export const MathHelperSkill = () => new Skill({
  name: "math-helper",
  description:
    "Use this skill whenever the user asks for arithmetic that should be computed exactly " +
    "rather than estimated from the model's own reasoning — sums, running totals, or " +
    "anything written to a file afterward.",
  instructions: `
- Always use the math-sum tool for addition instead of computing it yourself.
- If asked to save a result, write it to disk with fs-write-file and confirm the path back to the user.
  `,
  tools: [
    SumTool(),
    FsReadFileTool(),
    FsWriteFileTool(),
  ],
});
```

```ts
const agent = new SimpleAgent({
  aiProvider: ollamaProvider,
  instruction: "You are a helpful assistant.",
  skills: [MathHelperSkill()],
});
```


