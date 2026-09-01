import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserScrollTool = () => new MCPTool({
    name: "browser-scroll",
    description: "scroll the page to a given vertical position (in pixels)",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to scroll",
            required: true,
        },
        {
            name: "position",
            type: "number",
            description: "target vertical scroll position, in pixels",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: any
    ): Promise<any> => {
        const { sessionId, position } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (typeof position !== "number" || !Number.isFinite(position)) {
            throw new Error("position must be a number");
        }

        const session = getSession(sessionId);

        const info = await session.page.evaluate((pos: number) => {
            window.scrollTo(0, pos);
            return {
                length: document.documentElement.scrollHeight,
                position: window.scrollY,
            };
        }, position);

        return info;
    },
});

export default BrowserScrollTool;
