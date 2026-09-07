import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";
import type { SwarmAgentInfo } from "./registry.js";

export const AgentHireTool = (registry: AgentToolsRegistry) => {
    const maxHired = registry.getMaxHired();
    const limitNote = maxHired !== undefined
        ? ` At most ${maxHired} agent${maxHired === 1 ? "" : "s"} may be hired across the whole swarm at once — that budget is shared with every other agent that can hire, so check agent-types for remaining slots and fire what you no longer need.`
        : "";

    return new MCPTool({
        name: "agent-hire",
        description: `hire a new agent of one of the types from agent-types. It starts idle — use agent-prompt to give it work — and reports back only to you.${limitNote}`,
        inputs: [
            {
                name: "type",
                type: "string",
                description: "the agent type to hire, exactly as agent-types spells it",
                required: true,
            },
            {
                name: "group",
                type: "string",
                description: "optional group name to put this agent in. Agents in the same group can broadcast to each other with agent-report-group without going through you — useful when several agents work the same area and need to stay in sync.",
                required: false,
            },
            {
                name: "briefing",
                type: "string",
                description: "optional context appended to this agent's standing instruction for its whole lifetime — the project background it should never forget. Per-task work goes in agent-prompt instead.",
                required: false,
            },
        ],
        execute: async (
            _envID: string,
            inputs: Record<string, any>
        ): Promise<any> => {
            const { type, group, briefing } = inputs;

            if (!type || typeof type !== "string") {
                throw new Error("type must be a non-empty string");
            }
            if (group !== undefined && typeof group !== "string") {
                throw new Error("group must be a string when given");
            }
            if (briefing !== undefined && typeof briefing !== "string") {
                throw new Error("briefing must be a string when given");
            }

            const { controller, agentId } = registry.requireCaller();

            if (!registry.requireAgent(controller, agentId).active) {
                throw new Error("a fired agent cannot hire.");
            }

            const limit = registry.getMaxHired();
            if (limit !== undefined && registry.countHired() >= limit) {
                throw new Error(
                    `cannot hire "${type}" — the swarm's shared limit of ${limit} hired agent(s) is already reached. ` +
                    `Fire an agent you no longer need (agent-fire), or use one already working (agent-active).`
                );
            }

            const hired = await registry.request<SwarmAgentInfo>("agent-hire", agentId, { type, group, briefing });

            return {
                hired: true,
                agentId: hired.agentId,
                type: hired.type,
                groups: hired.groups,
                remaining: registry.getRemaining() ?? null,
            };
        },
    });
};

export default AgentHireTool;
