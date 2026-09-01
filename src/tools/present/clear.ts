import { rm } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { listPresentFiles } from "./utils.js";

export const PresentClearTool = () => new MCPTool({
    name: "present-clear",
    description: "remove every file currently presented to the user, emptying the present folder. use this to clear out stale presents before presenting a fresh set.",
    inputs: [],
    execute: async (
        _envID: string,
        _inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: MCP
    ): Promise<any> => {
        const existing = await listPresentFiles();

        await Promise.all(existing.map((path) => rm(path, { force: true })));

        // Present folder is now empty; still emit so listeners can
        // immediately reflect that nothing is presented anymore.

        return {
            message: "success",
            removed: existing.length,
        };
    },
});

export default PresentClearTool;
