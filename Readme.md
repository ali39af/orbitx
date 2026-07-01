[![OrbitX Logo](https://raw.githubusercontent.com/ali39af/orbitx/refs/heads/main/orbitx.png)](#)

## Installation

```bash
npm install orbitx
```


## Quick Start (Templates)

### Simple Agent

The `SimpleAgent` is the fastest way to get an agent running with tools and a chosen AI provider.

```ts
import { OllamaProvider, SimpleAgent, GetCurrentTimeTool } from "orbitx";

const ollamaProvider = new OllamaProvider("gemma3:latest");

const agent = new SimpleAgent({
  aiProvider: ollamaProvider,
  instruction: "You are a helpful assistant.",
  tools: [GetCurrentTimeTool],
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

### Researcher Agent

The `ResearcherAgent` is optimized for open-ended research and synthesis tasks.

```ts
import { OllamaProvider, ResearcherAgent } from "orbitx";

const ollamaProvider = new OllamaProvider("gemma3:latest");

const agent = new ResearcherAgent({ aiProvider: ollamaProvider });

let oldRole: "assistant" | "tool" | undefined;

agent.run("How artificial intelligence is changing the job market", (chunk) => {
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

### Creating a Custom Tool

Define your own tools with `MCPTool` to extend an agent's capabilities and integrate with your own ecosystem. also currently we have `ReadFileTool`, `WriteFileTool`, `GetCurrentTimeTool`, `FetchTool`, `WebSearchTool`, `ReadWebPageTool`

⚠️ EXTREMELY IMPORTANT WARNING ABOUT `WriteFileTool` ⚠️

🔴 CRITICAL: USE `WriteFileTool` WITH EXTREME CAUTION – THIS TOOL CAN PERMANENTLY OVERWRITE, DELETE, OR CORRUPT EXISTING FILES ON YOUR SYSTEM WITHOUT UNDO CAPABILITY.

```ts
import { MCPTool } from "orbitx";

export const SumTool = new MCPTool({
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
  execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
    const { first, second } = inputs;

    if (!first || typeof first !== "number") {
      throw new Error("first must be a number");
    }

    if (!second || typeof second !== "number") {
      throw new Error("second must be a number");
    }

    return {
      output: first + second,
    };
  },
});
```


### Building from the Base Agent

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
mcpServer.registerTool(GetCurrentTimeTool);

const mcpClient = new MCPClient("DEFAULT_ENV", connection);

const agent = new BaseAgent({
  aiProvider: ollamaProvider,
  instruction: "",
  mcpClient,
  allowedTools: [GetCurrentTimeTool],
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