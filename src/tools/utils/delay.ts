import { MCPTool } from "../../core/mcp.js";

const MAX_DELAY_MS = 60_000;

/**
 * Artificial pause tool. Useful when an agent needs to deliberately slow its
 * own iteration pace (e.g. waiting for an external process to settle, giving
 * a frontend time to render a status update, or throttling itself between
 * repeated tool calls) rather than firing calls back-to-back.
 */
export const DelayTool = () => new MCPTool({
    name: "delay",
    description: "wait for a given number of milliseconds before continuing (max 60000ms)",
    inputs: [
        {
            name: "ms",
            type: "number",
            description: "how long to wait, in milliseconds (capped at 60000)",
            required: true,
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { ms } = inputs;

        if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
            throw new Error("ms must be a non-negative number");
        }

        const clamped = Math.min(ms, MAX_DELAY_MS);

        await new Promise((resolve) => setTimeout(resolve, clamped));

        return {
            waited: clamped,
        };
    },
});

export default DelayTool;
