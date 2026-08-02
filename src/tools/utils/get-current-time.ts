import { MCPTool } from "../../core/mcp.js";

/**
 * Returns the current date/time. Agents should call this before writing
 * time-sensitive search queries or reasoning about "latest"/"current" facts,
 * since the model's own training data has no reliable sense of "now".
 */
export const GetCurrentTimeTool = () => new MCPTool({
    name: "get-current-time",
    description: "get the current date and time (ISO string, unix timestamp and timezone)",
    inputs: [],
    execute: async (): Promise<any> => {
        const now = new Date();

        return {
            iso: now.toISOString(),
            unix: Math.floor(now.getTime() / 1000),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
    },
});

export default GetCurrentTimeTool;
