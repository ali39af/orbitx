import { MCPTool } from "../../core/mcp.js";
import { removeSession } from "./session-manager.js";

export const BrowserRemoveSessionTool = () => new MCPTool({
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
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: any
    ): Promise<any> => {
        const { sessionId } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        await removeSession(sessionId);

        return {
            message: "success",
        };
    },
});

export default BrowserRemoveSessionTool;
