import { MCPTool } from "../../core/mcp.js";
import { getSession } from "./session-manager.js";

const OUTPUT_CAP = 5000;

export const BrowserInjectTool = () => new MCPTool({
    name: "browser-inject",
    description: "evaluate arbitrary JavaScript inside a browser session's page and return its result (capped at 5000 characters)",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to inject into",
            required: true,
        },
        {
            name: "eval",
            type: "string",
            description: "javascript expression/statement to evaluate in the page context",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: any
    ): Promise<any> => {
        const { sessionId, eval: code } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!code || typeof code !== "string") {
            throw new Error("eval must be a non-empty string");
        }

        const session = getSession(sessionId);

        let result: any;
        try {
            // page.evaluate() accepts a raw string and runs it directly in
            // the page context; wrapping in an async IIFE lets both bare
            // expressions and multi-statement code work, and lets us
            // await any promises the injected code returns.
            result = await session.page.evaluate(`(async () => { ${code} })()`);
        } catch (err: any) {
            result = `Error: ${err?.message || String(err)}`;
        }

        const content = typeof result === "string" ? result : JSON.stringify(result);

        return {
            content: (content || "").slice(0, OUTPUT_CAP),
        };
    },
});

export default BrowserInjectTool;
