import { readdir, stat } from "fs/promises";
import { join } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

export const FsListDirTool = () => new MCPTool<FsInteraction>({
    name: "fs-list-dir",
    description:
        "list the entries (files and directories) inside a directory, optionally paging through the results by entry index so very large directories (especially with recursive: true) never need to be returned in one shot",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the directory",
            required: true,
        },
        {
            name: "recursive",
            type: "boolean",
            description: "recurse into subdirectories",
            required: false,
            default: false,
        },
        {
            name: "offsetResult",
            type: "number",
            description: "entry offset to start listing from (for paging through large directories)",
            required: false,
            default: 0,
        },
        {
            name: "limitResult",
            type: "number",
            description: "max number of entries to return",
            required: false,
            default: 500,
        },
    ],
    customClass: new FsInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: FsInteraction
    ): Promise<any> => {
        const { path, recursive = false, offsetResult = 0, limitResult = 500 } = inputs;

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "listing", path: fullPath });

        let dirents;
        try {
            dirents = await readdir(fullPath, { withFileTypes: true, recursive });
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no directory found at "${path}"`);
            if (err.code === "ENOTDIR") throw new Error(`"${path}" is a file, not a directory`);
            throw err;
        }

        const entries = await Promise.all(
            dirents.map(async (d) => {
                const entryPath = join((d as any).parentPath || (d as any).path || fullPath, d.name);
                let size: number | undefined;
                if (d.isFile()) {
                    try {
                        size = (await stat(entryPath)).size;
                    } catch {
                        size = undefined;
                    }
                }
                return {
                    name: d.name,
                    path: entryPath,
                    type: d.isDirectory() ? "directory" : d.isSymbolicLink() ? "symlink" : "file",
                    size,
                };
            })
        );

        const totalResult = entries.length;
        const start = Math.max(0, Math.min(offsetResult, totalResult));
        const end = Math.max(start, Math.min(start + limitResult, totalResult));
        const page = entries.slice(start, end);

        return {
            entries: page,
            result: page,
            total: totalResult,
            totalResult,
            offsetResult: start,
            limitResult,
        };
    },
});

export default FsListDirTool;
