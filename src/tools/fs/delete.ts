import { rm, stat } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { resolvePath } from "./utils.js";

export const FsDeleteTool = () => new MCPTool({
    name: "fs-delete",
    description:
        "permanently delete a file or a directory (with all of its contents when recursive is true). USE WITH CAUTION: there is no undo.",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to delete",
            required: true,
        },
        {
            name: "recursive",
            type: "boolean",
            description: "if the path is a non-empty directory, delete it and everything inside it",
            required: false,
            default: false,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: MCP
    ): Promise<any> => {
        const { path, recursive = false } = inputs;

        const fullPath = resolvePath(path);

        let wasDirectory = false;
        try {
            wasDirectory = (await stat(fullPath)).isDirectory();
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file or directory found at "${path}"`);
            throw err;
        }

        await rm(fullPath, { recursive, force: false });

        return {
            message: "success",
            type: wasDirectory ? "directory" : "file",
        };
    },
});

export default FsDeleteTool;
