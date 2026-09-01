import { MCPTool, generateRefId, type MCP } from "../../core/mcp.js";
import { createSession } from "./session-manager.js";

export const BrowserCreateSessionTool = () => new MCPTool({
    name: "browser-create-session",
    description: "open a new headless browser session at a given url, returns its sessionId",
    inputs: [
        {
            name: "url",
            type: "string",
            description: "url to open the session at",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        mcp?: MCP
    ): Promise<any> => {
        const { url } = inputs;

        if (!url || typeof url !== "string") {
            throw new Error("url must be a non-empty string");
        }

        const sessionId = await generateRefId(mcp);

        await createSession(url, sessionId);

        return {
            sessionId,
        };
    },
});

export default BrowserCreateSessionTool;
