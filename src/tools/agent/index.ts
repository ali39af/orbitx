export { AgentListTool } from "./list.js";
export { AgentHireTool } from "./hire.js";
export { AgentPromptTool } from "./prompt.js";
export { AgentReportTool } from "./report.js";
export { AgentRegistry } from "./registry.js";
export { AgentInteraction } from "./interaction.js";
export type { AgentInfo } from "./registry.js";
export type { AgentEvent } from "./interaction.js";

import type WorkerAgent from "../../core/worker-agent.js";
import { AgentListTool } from "./list.js";
import { AgentHireTool } from "./hire.js";
import { AgentPromptTool } from "./prompt.js";
import { AgentRegistry } from "./registry.js";

export interface AgentToolsOptions {
    /** Cap on how many workers may be hired at once. Omit for no limit. Surfaced dynamically in agent-hire's own description (and in agent-list's output) so the model knows the constraint without being told out of band. */
    maxHired?: number;
}

/**
 * EXPERIMENTAL — see the note on WorkerAgent (src/core/worker-agent.ts).
 *
 * Planner-side tools for a fixed roster of WorkerAgents: list them, hire
 * one, and prompt a hired one. Each call builds its own AgentRegistry, so
 * separate AgentTools(...) calls (e.g. for two different planners in the
 * same process) never share hire state.
 *
 * Not included here: AgentReportTool — that one goes on each *worker's*
 * own tool list instead, not the planner's. Import it separately.
 */
export const AgentTools = (availableAgents: WorkerAgent[], options: AgentToolsOptions = {}) => {
    const registry = new AgentRegistry(availableAgents, options.maxHired);
    return [
        AgentListTool(registry),
        AgentHireTool(registry),
        AgentPromptTool(registry),
    ];
};

export default AgentTools;
