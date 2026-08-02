import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";

export const BrowserNavigateTool = () => new MCPTool<BrowserInteraction>({
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
    customClass: new BrowserInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: any,
        customClass?: BrowserInteraction
    ): Promise<any> => {
        const { sessionId, url } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!url || typeof url !== "string") {
            throw new Error("url must be a non-empty string");
        }

        customClass?.emitBrowserEvent({ type: "navigating", sessionId, url });

        const session = getSession(sessionId);
        await session.page.goto(url, { waitUntil: "domcontentloaded" });

        return {
            message: "success",
        };
    },
});

export default BrowserNavigateTool;
