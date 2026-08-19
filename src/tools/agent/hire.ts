import { MCPTool, type MCP } from "../../core/mcp.js";
import { AgentInteraction } from "./interaction.js";
import type AgentRegistry from "./registry.js";

export const AgentHireTool = (registry: AgentRegistry) => {
    const maxHired = registry.getMaxHired();
    const limitNote = maxHired !== undefined
        ? ` At most ${maxHired} worker agent${maxHired === 1 ? "" : "s"} may be hired at once — hiring beyond that will fail until fewer than ${maxHired} are currently hired, so choose which agent(s) to hire carefully.`
        : "";

    return new MCPTool<AgentInteraction>({
        name: "agent-hire",
        description: `hire a worker agent by name (see agent-list), making it active. Required once per agent before agent-prompt will work on it — hiring the same agent again is a harmless no-op.${limitNote}`,
        inputs: [
            {
                name: "name",
                type: "string",
                description: "the worker agent's name, exactly as shown by agent-list",
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
            const { name } = inputs;

            if (!name || typeof name !== "string") {
                throw new Error("name must be a non-empty string");
            }

            registry.hire(name);
            customClass?.emitAgentEvent({ type: "hired", name });

            return { hired: true, name };
        },
    });
};

export default AgentHireTool;
