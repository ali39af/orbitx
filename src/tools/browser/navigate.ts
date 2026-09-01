import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserNavigateTool = () => new MCPTool({
    name: "browser-navigate",
    description: "navigate an existing browser session to a new url",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to navigate",
            required: true,
        },
        {
            name: "url",
            type: "string",
            description: "url to navigate to",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: any
    ): Promise<any> => {
        const { sessionId, url } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!url || typeof url !== "string") {
            throw new Error("url must be a non-empty string");
        }

        const session = getSession(sessionId);
        await session.page.goto(url, { waitUntil: "domcontentloaded" });

        return {
            message: "success",
        };
    },
});

export default BrowserNavigateTool;
