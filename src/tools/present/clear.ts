import { rm } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { PresentInteraction } from "./interaction.js";
import { listPresentFiles } from "./utils.js";

export const PresentClearTool = () => new MCPTool<PresentInteraction>({
    name: "present-clear",
    description: "remove every file currently presented to the user, emptying the present folder. use this to clear out stale presents before presenting a fresh set.",
    inputs: [],
    customClass: new PresentInteraction(),
    execute: async (
        _envID: string,
        _inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: PresentInteraction
    ): Promise<any> => {
        const existing = await listPresentFiles();

        await Promise.all(existing.map((path) => rm(path, { force: true })));

        // Present folder is now empty; still emit so listeners can
        // immediately reflect that nothing is presented anymore.
        customClass?.emitPresentEvent({ type: "presents-updated", paths: [] });

        return {
            message: "success",
            removed: existing.length,
        };
    },
});

export default PresentClearTool;
