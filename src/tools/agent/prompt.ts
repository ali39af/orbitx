import { MCPTool } from "../../core/mcp.js";
import type AgentToolsRegistry from "./registry.js";

export const AgentPromptTool = (registry: AgentToolsRegistry) => new MCPTool({
    name: "agent-prompt",
    description: "give a task to an agent you hired. Returns as soon as the task is handed over — the agent works in parallel with you and its answer arrives later as a report message from it, so do not wait or poll for a result. You can prompt several agents in a row to run them at the same time. Prompting an agent that is already mid-task adds your message to its current work rather than starting it over.",
    inputs: [
        {
            name: "agentId",
            type: "string",
            description: "id of the agent to task, as returned by agent-hire or shown in agent-active",
            required: true,
        },
        {
            name: "prompt",
            type: "string",
            description: "the task, written to stand on its own — the agent cannot see your conversation, only what you send here and the briefing it was hired with",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>
    ): Promise<any> => {
        const { agentId: target, prompt } = inputs;

        if (!target || typeof target !== "string") {
            throw new Error("agentId must be a non-empty string");
        }
        if (!prompt || typeof prompt !== "string") {
            throw new Error("prompt must be a non-empty string");
        }

        const { controller, agentId } = registry.requireCaller();
        const info = registry.requireAgent(controller, target);

        if (!info.active) {
            throw new Error(`"${target}" has been fired and can no longer be prompted.`);
        }
        if (info.parentId !== agentId) {
            throw new Error(`only ${info.parentId}, the agent that hired "${target}", can prompt it.`);
        }

        await registry.request("agent-prompt", agentId, {
            to: [target],
            message: `[task from ${agentId}, the agent that hired you]\n${prompt}`,
        });

        return { dispatched: true, agentId: target };
    },
});

export default AgentPromptTool;
