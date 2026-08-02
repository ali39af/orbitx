import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserConsoleTool = () => new MCPTool({
    name: "browser-console",
    description: "read console log messages captured from a browser session (each message capped at 1000 characters)",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to read console logs from",
            required: true,
        },
        {
            name: "limit",
            type: "number",
            description: "max number of messages to return",
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
    ],
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { sessionId, limit = 20, offset = 0 } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        const session = getSession(sessionId);

        return {
            messages: session.consoleLogs.slice(offset, offset + limit),
            total: session.consoleLogs.length,
        };
    },
});

export default BrowserConsoleTool;
