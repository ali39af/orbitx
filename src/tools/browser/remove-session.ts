import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { removeSession } from "./session-manager.js";

export const BrowserRemoveSessionTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-remove-session",
    description: "close and remove a browser session",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to close",
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
        const { sessionId } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        await removeSession(sessionId);

        customClass?.emitBrowserEvent({ type: "session-removed", sessionId });

        return {
            message: "success",
        };
    },
});

export default BrowserRemoveSessionTool;
