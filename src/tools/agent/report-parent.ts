import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentReportParentTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-report-parent",
    description: "report your result back to the agent that hired you, then stop. This ends your current turn immediately — do not call another tool or add commentary after it. Your parent decides what happens next: it may send you more work, or leave you idle.",
    inputs: [
        {
            name: "report",
            type: "string",
            description: "the result, findings, or answer to hand back — written to stand on its own, since your parent cannot see your conversation or your reasoning",
            required: true,
        },
    ],
    stopIterationAfterUsingThisTool: true,
    execute: async (
        _envID: string,
        inputs: Record<string, any>
    ): Promise<any> => {
        const { report } = inputs;

        if (!report || typeof report !== "string") {
            throw new Error("report must be a non-empty string");
        }

        const { controller, agentId } = registry.requireCaller();
        const self = registry.requireAgent(controller, agentId);

        if (!self.parentId) {
            throw new Error("you have no parent to report to — you are this swarm's entrypoint agent, so your answer goes to the user directly.");
        }

        const parent = registry.requireAgent(controller, self.parentId);
        if (!parent.active) {
            throw new Error(`the agent that hired you (${self.parentId}) is no longer active, so there is nobody to report to.`);
        }

        await registry.request("agent-report-parent", agentId, {
            to: [parent.agentId],
            message: `[report from ${agentId} (${self.type}), an agent you hired]\n${report}`,
        });

        return { delivered: true, to: parent.agentId };
    },
});

export default AgentReportParentTool;
