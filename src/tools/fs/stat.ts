import { stat } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

export const FsStatTool = () => new MCPTool<FsInteraction>({
    name: "fs-stat",
    description: "check whether a path exists and get its metadata (type, size, modified time)",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to inspect",
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
        const { path } = inputs;

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "stat", path: fullPath });

        try {
            const s = await stat(fullPath);
            return {
                exists: true,
                type: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file",
                size: s.size,
                modifiedAt: s.mtime.toISOString(),
                createdAt: s.birthtime.toISOString(),
            };
        } catch (err: any) {
            if (err.code === "ENOENT") {
                return { exists: false };
            }
            throw err;
        }
    },
});

export default FsStatTool;
