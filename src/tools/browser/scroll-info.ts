import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserScrollInfoTool = () => new MCPTool({
    name: "browser-scroll-info",
    description: "get the total scrollable length and current scroll position of the page",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to inspect",
            required: true,
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { sessionId } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        const session = getSession(sessionId);

        const info = await session.page.evaluate(() => ({
            length: document.documentElement.scrollHeight,
            position: window.scrollY,
        }));

        return info;
    },
});

export default BrowserScrollInfoTool;
