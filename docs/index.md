# OrbitX Docs

OrbitX is a TypeScript SDK for building AI agents: pluggable model providers, a tool/skill system, an MCP-based execution layer (in-process, IPC, or WebSocket), and a resumable agent loop with automatic memory compaction.

This directory is written for two audiences at once:

- **Humans** learning the library for the first time — read top to bottom.
- **AI coding agents** working inside a project that depends on `orbitx` — each page is self-contained enough to be read on its own when you only need one topic (e.g. "how do I define a tool").

## Pages

1. [Getting Started](./getting-started.md) — install, first agent, streaming output, resuming state.
2. [Providers](./providers.md) — `AIProvider`, the four built-in providers, capabilities, main/image roles.
3. [Agents](./agents.md) — `BaseAgent` vs `SimpleAgent`, the run loop, memory compaction, tokens.
4. [Tools](./tools.md) — the `MCPTool` shape, built-in tool catalog, writing your own tools.
5. [Skills](./skills.md) — bundling instructions + tools, built-in skill catalog, writing your own.
6. [MCP Architecture](./mcp-architecture.md) — `MCPServer`/`MCPClient`/connections, in-process vs IPC vs WS, `MCPComputer` sandbox.
7. [Streaming](./streaming.md) — the `StreamCallback` chunk shape and how to consume it.
8. [API Reference](./api-reference.md) — flat index of every public export from `orbitx`.

## The shape of the library, in one paragraph

You construct one or more `AIProvider` instances (OpenAI, Anthropic, DeepSeek, or Ollama), a list of `MCPTool`s and/or `Skill`s (a skill is just instructions + tools bundled together), and hand them to `SimpleAgent` (or `BaseAgent` for full control over the underlying MCP transport). Calling `agent.run(prompt, streamCallback)` drives a loop: send the conversation + tool schemas to the provider, dispatch any tool calls the model requests, feed results back, repeat until the model stops calling tools. Everything the model can see (tools, skills, instructions) is decided once, up front — there's no dynamic tool routing/selection step. Long conversations are handled by summarizing into a running `memory` string instead of ever deleting messages; the full history is preserved in `getCurrentAgentStates()` for persistence/resume.
