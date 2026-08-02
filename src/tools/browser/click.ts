import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";
import { resolveRef } from "./read-page.js";

export const BrowserClickTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-click",
    description: "click a clickable element on the page (a ref id previously returned by browser-read, marked [CLICKABLE])",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to act on",
            required: true,
        },
        {
            name: "ref",
            type: "string",
            description: "ref id of the element to click, e.g. 0x4",
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
        const { sessionId, ref } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!ref || typeof ref !== "string") {
            throw new Error("ref must be a non-empty string");
        }

        customClass?.emitBrowserEvent({ type: "clicking", sessionId, ref });

        const session = getSession(sessionId);
        const element = await resolveRef(session.page, ref);

        if (!element) {
            throw new Error(`ref "${ref}" was not found on the page (call browser-read again to get fresh refs)`);
        }

        await element.click();

        return {
            message: "success",
        };
    },
});

export default BrowserClickTool;
