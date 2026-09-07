# API Reference

Flat index of every public export from `orbitx` (see `src/index.ts`), grouped by area. Each links to the doc page with the actual explanation and examples.

## Core / Providers — see [Providers](./providers.md)

- `AIProvider` (abstract base class)
- `OpenAIProvider`, `AnthropicProvider`, `DeepSeekProvider`, `OllamaProvider`
- `resolveAgentProviders()`, `ProviderRegistry`
- Types: `AgentProviderEntry`, `AgentProvidersInput`
- Types: `ChatResponse`, `Message`, `MessageUsage`, `MessageUsageTokens`, `MessageUsageCost`, `StreamCallback`, `ToolSchema`, `ToolCallRequest`, `MessageContentPart`, `ProviderCapabilities`, `ProviderType` — see [Providers](./providers.md#provider-roles)
- `resolveThinkEffortLevel()`, `clampThinkEffort()` — the universal 0-1 `thinkEffort` → provider-native-level mapping helpers; see [Providers](./providers.md#think-effort)
- Type: `ThinkEffortLevel`
- `toOpenAIFunctionTools()` — translates a `ToolSchema[]` into OpenAI's function-calling format; exported for building custom providers.

## Agents — see [Agents](./agents.md)

- `BaseAgent`
- `SimpleAgent`
- Types: `ExtractedSegment`, `ParsedToolCall`

## Swarm — see [Swarm](./swarm.md)

- `SwarmBase` — types `SwarmBaseProps`, `SwarmRunOptions`, `SwarmState`, `SwarmAgentState`, `SwarmStreamChunk`, `SwarmStreamCallback`, `SwarmAgentFailure`
- `AgentDefinition`, `selectTools()`, `applyTextOverride()` — types `AgentDefinitionProps`, `AgentOverrides`, `AgentFactory`, `AgentFactoryOptions`, `TextOverride`
- Ready-made definitions: `PlannerAgent`, `ReasonerAgent` (+ `REASONER_PANEL_MS`), `BackendAgent`, `FrontendAgent`, `TestAgent`, `ResearchAgent`, `DefaultAgents()`, and the shared instruction fragments `PLANNER_PROTOCOL` / `WORKER_PROTOCOL` / `TEAM_PROTOCOL` / `PRODUCTION_BAR`

## Tools — see [Tools](./tools.md)

- `MCPTool`, `generateRefId()`, `normalizeToolOutput()`
- Types: `MCP`, `MCPToolOutput`

Built-in tool factories, grouped by domain (each domain also exports a `*Tools()` array):

| Domain | Exports |
|---|---|
| Filesystem | `FsReadFileTool`, `FsWriteFileTool`, `FsEditFileTool`, `FsListDirTool`, `FsCreateDirTool`, `FsDeleteTool`, `FsMoveTool`, `FsStatTool`, `FsTools` |
| Bash | `BashRunTool`, `BashWaitTool`, `BashLogsTool`, `BashListTool`, `BashWriteInputTool`, `BashTerminateTool`, `BashTools` |
| Browser | `BrowserCreateSessionTool`, `BrowserRemoveSessionTool`, `BrowserGetSessionsTool`, `BrowserNavigateTool`, `BrowserConsoleTool`, `BrowserInjectTool`, `BrowserReadTool`, `BrowserClickTool`, `BrowserFillTool`, `BrowserScrollInfoTool`, `BrowserScrollTool`, `BrowserNetworkStatusTool`, `BrowserNetworkTool`, `BrowserSubmitFormTool`, `BrowserScreenshotTool`, `BrowserTools` |
| Todo | `TodoCreateListTool`, `TodoRemoveListTool`, `TodoGetListsTool`, `TodoGetListTool`, `TodoCreateTaskTool`, `TodoRemoveTaskTool`, `TodoCheckTaskTool`, `TodoTools`, types `TodoTask`, `TodoList` |
| Present | `PresentAddTool`, `PresentClearTool`, `PresentGetListTool`, `PresentTools`, `getPresentFolder()` |
| Question/Answer | `QuestionAnswerTool`, `QuestionAnswerTools` |
| Utility | `GetCurrentTimeTool`, `DelayTool`, `ReadImageTool`, `UtilTools` |
| Swarm | `getAgentTools(options?)`, `AgentTypesTool`, `AgentHireTool`, `AgentFireTool`, `AgentActiveTool`, `AgentPromptTool`, `AgentReportParentTool`, `AgentReportGroupTool`, `AgentToolsRegistry`, types `AgentToolsOptions`, `AgentToolsHandle`, `SwarmController`, `SwarmAgentTypeInfo`, `SwarmAgentInfo`, `AgentToolsEvent`, `AgentToolsAck`, `AgentToolsListener` — see [Swarm](./swarm.md#getagenttoolsoptions) |

## Skills — see [Skills](./skills.md)

- `Skill`
- `BackendSecuritySkill`, `BigTaskSkill`, `CodeVerificationSkill`, `LongTaskEfficiencySkill`, `NodeBackendSkill`, `PlannerSkill`, `PresentSkill`, `QuestionAnswerSkill`, `ReactFrontendSkill`, `ResearchSkill`, `UiUxDesignSkill`, `WebEndToEndTestSkill`

## MCP transport — see [MCP Architecture](./mcp-architecture.md)

- `MCPServer`, `MCPClient`
- `MCPConnection`, `MCPIPCConnection`, `MCPWSConnection`
- `MCPComputer`, type `MCPComputerOptions` *(experimental)*
- `MCPStorage`, `MCPFSStorage`
- `MCPRNG`
- `MCPOutputFilter` (`MCPFilter` is a deprecated alias, removed in `1.0.0`)
- `MCPExecutionPolicy`, `MCPBypassExecutionPolicy`, type `MCPToolCallRequest`
