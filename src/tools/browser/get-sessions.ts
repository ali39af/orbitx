import { MCPTool } from "../../core/mcp.js";
import { getSessionIds } from "./session-manager.js";

export const BrowserGetSessionsTool = () => new MCPTool({
    name: "browser-get-sessions",
    description: "get all currently open browser session ids",
    inputs: [],
    execute: async (): Promise<any> => {
        return {
            sessions: getSessionIds(),
        };
    },
});

export default BrowserGetSessionsTool;
