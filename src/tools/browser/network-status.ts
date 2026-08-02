import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

export const BrowserNetworkStatusTool = () => new MCPTool({
    name: "browser-network-status",
    description: "check whether the page currently has in-flight network activity",
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

        // If the page reports document.readyState complete and there is
        // nothing left in the browser's resource timeline that hasn't
        // finished, we consider the network idle.
        const status = await session.page.evaluate(() => {
            const pending = performance
                .getEntriesByType("resource")
                .some((entry: any) => entry.responseEnd === 0);
            return document.readyState === "complete" && !pending ? "idle" : "loading";
        });

        return {
            status,
        };
    },
});

export default BrowserNetworkStatusTool;
