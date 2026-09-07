import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentFireTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-fire",
    description: "fire an agent you hired, freeing its slot for anyone in the swarm. If it's still working it is stopped immediately, so only fire an agent whose work is done. Its conversation is kept for the record but it can no longer be prompted.",
    inputs: [
        {
            name: "agentId",
            type: "string",
            description: "id of the agent to fire, as returned by agent-hire or shown in agent-active",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>
    ): Promise<any> => {
        const { agentId: target } = inputs;

        if (!target || typeof target !== "string") {
            throw new Error("agentId must be a non-empty string");
        }

        const { controller, agentId } = registry.requireCaller();
        const info = registry.requireAgent(controller, target);

        if (!info.active) {
            throw new Error(`"${target}" is already fired.`);
        }
        if (controller.isEntrypoint(target)) {
            throw new Error("the swarm's entrypoint agent cannot be fired.");
        }
        if (info.parentId !== agentId) {
            throw new Error(`only ${info.parentId}, the agent that hired "${target}", can fire it.`);
        }

        await registry.request("agent-fire", agentId, { agentId: target });

        return {
            fired: true,
            agentId: target,
            remaining: registry.getRemaining() ?? null,
        };
    },
});

export default AgentFireTool;
