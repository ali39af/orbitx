import { MCPTool, type MCP } from "../../core/mcp.js";
import { AgentInteraction } from "./interaction.js";
import type AgentRegistry from "./registry.js";

export const AgentPromptTool = (registry: AgentRegistry) => new MCPTool<AgentInteraction>({
    name: "agent-prompt",
    description: "send a prompt to a hired worker agent and wait for its response. The worker runs its own full turn (its own reasoning, its own tools) and either calls agent-report to hand back a result, or just stops on its own — either way this returns once it's done. You can call this again later on the same agent to continue the conversation (it remembers everything from earlier prompts), or move on and never call it again if its report says the work is finished.",
    inputs: [
        {
            name: "name",
            type: "string",
            description: "the hired worker agent's name, exactly as shown by agent-list",
            required: true,
        },
        {
            name: "prompt",
            type: "string",
            description: "the message to send to the worker agent",
            required: true,
        },
    ],
    customClass: new AgentInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: AgentInteraction
    ): Promise<any> => {
        const { name, prompt } = inputs;

        if (!name || typeof name !== "string") {
            throw new Error("name must be a non-empty string");
        }
        if (!prompt || typeof prompt !== "string") {
            throw new Error("prompt must be a non-empty string");
        }

        const agent = registry.get(name);
        if (!agent) {
            throw new Error(`no worker agent named "${name}" — check agent-list for available names.`);
        }
        if (!registry.isHired(name)) {
            throw new Error(`worker agent "${name}" is not hired yet — call agent-hire first.`);
        }

        customClass?.emitAgentEvent({ type: "prompted", name, prompt });

        const beforeLength = agent.getCurrentAgentStates().messagesFull.length;
        await agent.run(prompt);
        // Only look at messages this specific call produced — otherwise a
        // worker that answers in plain text (no fresh agent-report) could
        // surface a stale report left over from an earlier prompt.
        const newMessages = agent.getCurrentAgentStates().messagesFull.slice(beforeLength);

        let report: string | undefined;
        let reported = false;

        for (let i = newMessages.length - 1; i >= 0; i--) {
            const msg = newMessages[i];
            if (msg.role === "tool" && msg.toolName === "agent-report") {
                try {
                    report = JSON.parse(msg.content || "{}").report;
                } catch {
                    report = msg.content;
                }
                reported = true;
                break;
            }
        }

        if (!reported) {
            for (let i = newMessages.length - 1; i >= 0; i--) {
                const msg = newMessages[i];
                if (msg.role === "assistant" && msg.content) {
                    report = msg.content;
                    break;
                }
            }
        }

        report ??= "(worker agent produced no output this turn)";

        customClass?.emitAgentEvent({ type: "reported", name, reported, report });

        return { report, reported };
    },
});

export default AgentPromptTool;
