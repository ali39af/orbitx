import { MCPTool } from "../../core/mcp.js";
import type AgentRegistry from "./registry.js";

export const AgentListTool = (registry: AgentRegistry) => new MCPTool({
    name: "agent-list",
    description: "list every worker agent available to hire, with their name, description/persona, per-task-type rating, and whether they're already hired. Check this before hiring — pick whichever agent's rating best fits the task at hand, and check hiredCount against maxHired if there's a hiring limit.",
    inputs: [],
    execute: async (): Promise<any> => {
        const maxHired = registry.getMaxHired();
        return {
            agents: registry.list(),
            hiredCount: registry.getHiredCount(),
            ...(maxHired !== undefined ? { maxHired } : {}),
        };
    },
});

export default AgentListTool;
