import { rename, mkdir } from "fs/promises";
import { dirname } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

export const FsMoveTool = () => new MCPTool<FsInteraction>({
    name: "fs-move",
    description: "move or rename a file or directory",
    inputs: [
        {
            name: "from",
            type: "string",
            description: "absolute or cwd-relative source path",
            required: true,
        },
        {
            name: "to",
            type: "string",
            description: "absolute or cwd-relative destination path",
            required: true,
        },
    ],
    customClass: new FsInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: FsInteraction
    ): Promise<any> => {
        const { from, to } = inputs;

        const fullFrom = resolvePath(from);
        const fullTo = resolvePath(to);

        customClass?.emitFsEvent({ type: "moving", from: fullFrom, to: fullTo });

        await mkdir(dirname(fullTo), { recursive: true });

        try {
            await rename(fullFrom, fullTo);
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file or directory found at "${from}"`);
            throw err;
        }

        return {
            message: "success",
        };
    },
});

export default FsMoveTool;
