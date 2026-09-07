import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentTypesTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-types",
    description: "list every kind of agent you can hire into this swarm, with what each is good at, its per-task fit ratings, how many of that kind are already working, and how many hire slots remain. Check this before agent-hire so you pick the type that actually fits the task.",
    inputs: [],
    execute: async (): Promise<any> => {
        const controller = registry.requireController();

        return {
            types: controller.listTypes(),
            hired: registry.countHired(),
            maxHired: registry.getMaxHired() ?? null,
            remaining: registry.getRemaining() ?? null,
        };
    },
});

export default AgentTypesTool;
