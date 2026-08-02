import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";

export const BrowserScreenshotTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-screenshot",
    description:
        "capture a screenshot of the current page in a browser session. " +
        "returns an image tool-output — depending on how the agent is configured, the raw image may be handed directly to the model, or first described by a separate image-capable AI so the main conversation doesn't have to carry image bytes. " +
        "use `focusHint` to tell that description step what you actually care about (e.g. 'look for any red error banner or visually broken layout'), so the resulting description is useful for your task instead of a generic caption.",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to screenshot",
            required: true,
        },
        {
            name: "fullPage",
            type: "boolean",
            description: "capture the full scrollable page instead of just the current viewport",
            required: false,
            default: false,
        },
        {
            name: "focusHint",
            type: "string",
            description: "what to focus on when describing the screenshot, e.g. 'look for any red object or any bug on the UI'",
            required: false,
        },
    ],
    customClass: new BrowserInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: any,
        customClass?: BrowserInteraction
    ): Promise<any> => {
        const { sessionId, fullPage = false, focusHint } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        customClass?.emitBrowserEvent({ type: "screenshotting", sessionId });

        const session = getSession(sessionId);
        const image = await session.page.screenshot({ encoding: "base64", fullPage, type: "png" });

        return {
            type: "image",
            output: {
                image,
                mimeType: "image/png",
                ...(focusHint ? { focusHint } : {}),
            },
        };
    },
});

export default BrowserScreenshotTool;
