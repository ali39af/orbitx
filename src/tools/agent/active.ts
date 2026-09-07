import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentActiveTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-active",
    description: "list the agents currently hired in this swarm — their ids, types, groups, who hired them, and what each one is doing. Use it to see what you already have working before hiring more, and to find the id of an agent you want to prompt or fire. Two fields say what an agent is doing, and they only mean anything together: `busy` is true while it is generating right now, and `awaitingReport` is true from the moment it was tasked until it reports back. busy+awaitingReport = working. awaitingReport without busy = tasked, paused mid-task, and still owes you an answer — it is blocked on something outside the swarm, most often a question it put to the user, so leave it alone. Neither = idle and owes you nothing.",
    inputs: [
        {
            name: "group",
            type: "string",
            description: "optional group name to filter by — only agents in that group are listed",
            required: false,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>
    ): Promise<any> => {
        const { group } = inputs;

        if (group !== undefined && typeof group !== "string") {
            throw new Error("group must be a string when given");
        }

        const { controller, agentId } = registry.requireCaller();

        const agents = controller.listAgents()
            .filter(agent => agent.active && !controller.isEntrypoint(agent.agentId))
            .filter(agent => !group || agent.groups.includes(group))
            .map(({ agentId: id, type, parentId, groups, busy, awaitingReport }) => ({
                agentId: id,
                type,
                ...(parentId ? { parentId } : {}),
                groups,
                busy,
                awaitingReport,
                yours: parentId === agentId,
            }));

        return {
            agents,
            hired: registry.countHired(),
            maxHired: registry.getMaxHired() ?? null,
            remaining: registry.getRemaining() ?? null,
        };
    },
});

export default AgentActiveTool;
