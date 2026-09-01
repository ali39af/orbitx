import { MCPTool, type MCP } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserScreenshotTool = () => new MCPTool({
    name: "browser-screenshot",
    description:
        "capture a screenshot of the current page in a browser session and get back a text description of it. " +
        "use `focusHint` to tell the description step what you actually care about (e.g. 'look for any red error banner or visually broken layout'), so the resulting description is useful for your task instead of a generic caption.",
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
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        toolCallId?: string,
        mcp?: MCP
    ): Promise<any> => {
        const { sessionId, fullPage = false, focusHint } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        const session = getSession(sessionId);
        const image = await session.page.screenshot({ encoding: "base64", fullPage, type: "png" });

        if (!mcp || !toolCallId) {
            throw new Error("browser-screenshot requires an MCP context");
        }

        const instruction = focusHint
            ? `Describe this screenshot concisely for another AI agent that cannot see it. Focus specifically on: ${focusHint}`
            : "Describe this screenshot concisely for another AI agent that cannot see it. Mention layout, visible text, colors, and anything that looks unusual or broken.";

        const { output } = await mcp.executeProvider(toolCallId, "image-describer", {
            parts: [
                { type: "text", text: instruction },
                { type: "image", image, mimeType: "image/png" },
            ],
        });

        return { description: output.content };
    },
});

export default BrowserScreenshotTool;
