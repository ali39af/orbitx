import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

export const FsWriteFileTool = () => new MCPTool<FsInteraction>({
    name: "fs-write-file",
    description:
        "write text content to a file, overwriting it if it already exists (or creating it, along with any missing parent directories, if it doesn't). USE WITH CAUTION: this permanently overwrites existing file content with no undo.",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the file",
            required: true,
        },
        {
            name: "content",
            type: "string",
            description: "full text content to write",
            required: true,
        },
        {
            name: "createDirs",
            type: "boolean",
            description: "create missing parent directories if needed",
            required: false,
            default: true,
        },
    ],
    customClass: new FsInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: FsInteraction
    ): Promise<any> => {
        const { path, content, createDirs = true } = inputs;

        if (typeof content !== "string") {
            throw new Error("content must be a string");
        }

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "writing", path: fullPath });

        if (createDirs) {
            await mkdir(dirname(fullPath), { recursive: true });
        }

        await writeFile(fullPath, content, { encoding: "utf-8" });

        return {
            message: "success",
            bytesWritten: Buffer.byteLength(content, "utf-8"),
        };
    },
});

export default FsWriteFileTool;
