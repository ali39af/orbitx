# Getting Started

## Install

```bash
npm install orbitx
```

## Your first agent

The fastest path is `SimpleAgent`: give it a provider, an instruction, and a list of tools/skills. It wires up an in-process MCP server/client for you automatically.

```ts
import { OllamaProvider, SimpleAgent, GetCurrentTimeTool } from "orbitx";

const provider = new OllamaProvider("gemma4:e4b");

const agent = new SimpleAgent({
  aiProvider: provider,
  instruction: "You are a helpful assistant.",
  tools: [GetCurrentTimeTool()],
});

await agent.run("what is current time?", (chunk) => {
  process.stdout.write(chunk.content);
});
```

`agent.run(prompt, streamCallback)` resolves once the model has stopped calling tools and produced a final answer. The `streamCallback` is optional — omit it if you only care about the eventual message history via `getCurrentAgentStates()`.

See [Streaming](./streaming.md) for the full chunk shape (roles, tool call/result chunks, `done` flag).

## Choosing a provider

```ts
import { OllamaProvider, DeepSeekProvider, AnthropicProvider, OpenAIProvider } from "orbitx";

new OllamaProvider("gemma4:e4b");                        // local, via Ollama
new DeepSeekProvider("api-key", "deepseek-v4-flash");     // hosted
new AnthropicProvider("api-key", "claude-sonnet-5");      // hosted
new OpenAIProvider("api-key", "gpt-5");                   // hosted
```

Every provider implements the same `AIProvider` interface, so switching models is a one-line change to your agent's `aiProvider`. Details, capability flags, and the main/image role split are in [Providers](./providers.md).

## Tools and skills up front

`SimpleAgent`'s `tools` and `skills` lists are baked into the system prompt once, at construction time — there's no per-turn tool selection/routing step deciding what the model is allowed to see. If you want the model to be able to call something, put it in `tools` (or bundle it inside a `Skill`). See [Tools](./tools.md) and [Skills](./skills.md).

## Recovering an agent's state

`getCurrentAgentStates()` returns a plain JSON-serializable snapshot: message history, running memory summary, and token counters. Persist it anywhere; pass it back in as `initData` to resume the exact same agent later (after a process restart, in a new request handler, etc.):

```ts
import { writeFileSync, existsSync, readFileSync } from "fs";

const initData = existsSync("./state.json")
  ? JSON.parse(readFileSync("./state.json", "utf-8"))
  : undefined;

const agent = new SimpleAgent({
  aiProvider: provider,
  instruction: "You are a helpful assistant.",
  tools: [GetCurrentTimeTool()],
  ...(initData ? { initData } : {}),
});

// after any run() call:
writeFileSync("./state.json", JSON.stringify(agent.getCurrentAgentStates()));
```

Messages are only ever appended, never rewritten. When the conversation grows past the memory threshold, OrbitX keeps the full history on disk (`messagesFull`) but resets the model's *working* context from a running summary, so an agent can keep going indefinitely without losing the ability to act on what happened earlier. Mechanics are covered in [Agents](./agents.md#memory-compaction).

## Next steps

- Full control over the MCP transport (custom server/client, IPC, WebSocket, sandboxed Docker execution): [MCP Architecture](./mcp-architecture.md).
- Writing your own tool or skill: [Tools](./tools.md#writing-a-custom-tool), [Skills](./skills.md#writing-a-custom-skill).
- Every public export: [API Reference](./api-reference.md).
