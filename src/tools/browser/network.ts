import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserNetworkTool = () => new MCPTool({
    name: "browser-network",
    description: "read network activity logs captured from a browser session (each request/response body capped at 1000 characters)",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to read network logs from",
            required: true,
        },
        {
            name: "limit",
            type: "number",
            description: "max number of entries to return",
            required: false,
            default: 20,
        },
        {
            name: "offset",
            type: "number",
            description: "offset into the log buffer",
            required: false,
            default: 0,
        },
        {
            name: "type",
            type: "string",
            description: "filter by resource type, e.g. \"fetch\", \"xhr\", \"document\", \"image\", \"media\", or \"all\"",
            required: false,
            default: "all",
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { sessionId, limit = 20, offset = 0, type = "all" } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        const session = getSession(sessionId);

        const filtered = type && type !== "all"
            ? session.networkLogs.filter((entry) => entry.type === type)
            : session.networkLogs;

        return {
            messages: filtered.slice(offset, offset + limit),
            total: filtered.length,
        };
    },
});

export default BrowserNetworkTool;
