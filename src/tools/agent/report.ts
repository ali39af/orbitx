import { MCPTool } from "../../core/mcp.js";

/**
 * For WorkerAgents, not planners: include this in a worker's own
 * `allowedTools` (and register it on whatever MCPServer that worker uses)
 * so it can hand a result back to whoever hired and prompted it. Calling
 * this always ends the worker's current turn immediately
 * (stopIterationAfterUsingThisTool) — AgentPromptTool picks the reported
 * text back up on the hiring agent's side once agent.run() resolves.
 */
export const AgentReportTool = () => new MCPTool({
    name: "agent-report",
    description: "report your result back to whichever agent hired and prompted you, then stop. This ends your current turn immediately — do not call any other tool or add commentary after this. The hiring agent decides what happens next: it may prompt you again to continue this same task, or move on and not call you again if your report shows you're done.",
    inputs: [
        {
            name: "report",
            type: "string",
            description: "the result/findings/answer to hand back — write it so it's understandable on its own, without the hiring agent needing to see your internal reasoning",
            required: true,
        },
    ],
    stopIterationAfterUsingThisTool: true,
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { report } = inputs;

        if (!report || typeof report !== "string") {
            throw new Error("report must be a non-empty string");
        }

        return { report };
    },
});

export default AgentReportTool;
