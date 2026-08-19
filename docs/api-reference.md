# API Reference

Flat index of every public export from `orbitx` (see `src/index.ts`), grouped by area. Each links to the doc page with the actual explanation and examples.

## Core / Providers — see [Providers](./providers.md)

- `AIProvider` (abstract base class)
- `OpenAIProvider`, `AnthropicProvider`, `DeepSeekProvider`, `OllamaProvider`
- `resolveAgentProviders()`
- Types: `AgentProviderRole`, `AgentProviderEntry`, `AgentProvidersInput`, `ResolvedAgentProviders`
- Types: `ChatResponse`, `Message`, `StreamCallback`, `ToolSchema`, `ToolCallRequest`, `MessageContentPart`, `ProviderCapabilities`
- `resolveThinkEffortLevel()`, `clampThinkEffort()` — the universal 0-1 `thinkEffort` → provider-native-level mapping helpers; see [Providers](./providers.md#think-effort)
- Type: `ThinkEffortLevel`
- `ImageDescriber` — used internally by `BaseAgent` to describe image tool output via the `image` provider role; exported for direct use if you want to describe an image outside the agent loop.
- `toOpenAIFunctionTools()` — translates a `ToolSchema[]` into OpenAI's function-calling format; exported for building custom providers.

## Agents — see [Agents](./agents.md)

- `BaseAgent`
- `SimpleAgent`
- Types: `ExtractedSegment`, `ParsedToolCall`

## Tools — see [Tools](./tools.md)

- `MCPTool`, `MCPCustomClass`, `generateRefId()`, `normalizeToolOutput()`
- Types: `MCP`, `MCPToolOutput`

Built-in tool factories, grouped by domain (each domain also exports a `*Tools()` array and a `*Interaction` EventEmitter):

| Domain | Exports |
|---|---|
| Filesystem | `FsReadFileTool`, `FsWriteFileTool`, `FsEditFileTool`, `FsListDirTool`, `FsCreateDirTool`, `FsDeleteTool`, `FsMoveTool`, `FsStatTool`, `FsTools`, `FsInteraction`, type `FsEvent` |
| Bash | `BashRunTool`, `BashWaitTool`, `BashLogsTool`, `BashListTool`, `BashWriteInputTool`, `BashTerminateTool`, `BashTools`, `BashInteraction`, type `BashEvent` |
| Browser | `BrowserCreateSessionTool`, `BrowserRemoveSessionTool`, `BrowserGetSessionsTool`, `BrowserNavigateTool`, `BrowserConsoleTool`, `BrowserInjectTool`, `BrowserReadTool`, `BrowserClickTool`, `BrowserFillTool`, `BrowserScrollInfoTool`, `BrowserScrollTool`, `BrowserNetworkStatusTool`, `BrowserNetworkTool`, `BrowserSubmitFormTool`, `BrowserScreenshotTool`, `BrowserTools`, `BrowserInteraction`, type `BrowserEvent` |
| Todo | `TodoCreateListTool`, `TodoRemoveListTool`, `TodoGetListsTool`, `TodoGetListTool`, `TodoCreateTaskTool`, `TodoRemoveTaskTool`, `TodoCheckTaskTool`, `TodoTools`, `TodoInteraction`, types `TodoTask`, `TodoList`, `TodoEvent` |
| Present | `PresentAddTool`, `PresentClearTool`, `PresentGetListTool`, `PresentTools`, `getPresentFolder()`, `PresentInteraction`, type `PresentEvent` |
| Question/Answer | `QuestionAnswerTool`, `QuestionAnswerTools`, `QuestionAnswerInteraction`, type `QuestionAnswerEvent` |
| Utility | `GetCurrentTimeTool`, `DelayTool`, `UtilTools` |

## Skills — see [Skills](./skills.md)

- `Skill`
- `BackendSecuritySkill`, `BigTaskSkill`, `CodeVerificationSkill`, `LongTaskEfficiencySkill`, `NodeBackendSkill`, `PlannerSkill`, `PresentSkill`, `QuestionAnswerSkill`, `ReactFrontendSkill`, `ResearchSkill`, `ShoppingSkill`, `UiUxDesignSkill`, `WebEndToEndTestSkill`

## MCP transport — see [MCP Architecture](./mcp-architecture.md)

- `MCPServer`, `MCPClient`
- `MCPConnection`, `MCPIPCConnection`, `MCPWSConnection`
- `MCPComputer` *(experimental)*
- `MCPStorage`, `MCPFSStorage`
- `MCPRNG`
- `MCPFilter`
