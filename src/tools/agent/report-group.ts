import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentReportGroupTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-report-group",
    description: "send a message to every other agent in your group — a decision you made, an interface you settled on, something you found that changes their work. Your parent does not see it, so this is not a substitute for agent-report-parent. You keep working after sending; it does not end your turn.",
    inputs: [
        {
            name: "message",
            type: "string",
            description: "what your group needs to know, written to stand on its own — they cannot see your conversation",
            required: true,
        },
        {
            name: "group",
            type: "string",
            description: "which of your groups to send to. Only needed if you belong to more than one; otherwise your only group is used.",
            required: false,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>
    ): Promise<any> => {
        const { message, group } = inputs;

        if (!message || typeof message !== "string") {
            throw new Error("message must be a non-empty string");
        }
        if (group !== undefined && typeof group !== "string") {
            throw new Error("group must be a string when given");
        }

        const { controller, agentId } = registry.requireCaller();
        const self = registry.requireAgent(controller, agentId);

        if (self.groups.length === 0) {
            throw new Error("you are not in any group — only agents hired into a group can send group messages.");
        }
        if (group !== undefined && !self.groups.includes(group)) {
            throw new Error(`you are not in group "${group}" — your groups: ${self.groups.join(", ")}.`);
        }
        if (group === undefined && self.groups.length > 1) {
            throw new Error(`you belong to more than one group, so name the one to send to: ${self.groups.join(", ")}.`);
        }

        const target = group ?? self.groups[0];
        const members = controller.listAgents()
            .filter(a => a.active && a.agentId !== agentId && a.groups.includes(target))
            .map(a => a.agentId);

        await registry.request("agent-report-group", agentId, {
            to: members,
            message: `[group "${target}" message from ${agentId} (${self.type})]\n${message}`,
        });

        return { delivered: true, group: target, to: members };
    },
});

export default AgentReportGroupTool;
