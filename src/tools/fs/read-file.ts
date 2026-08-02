import { readFile } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath, toLines, paginateLines } from "./utils.js";

export const FsReadFileTool = () => new MCPTool<FsInteraction>({
    name: "fs-read-file",
    description:
        "read a text file from disk, optionally paging through it by line so large files never need to be read in one shot",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the file",
            required: true,
        },
        {
            name: "offsetLine",
            type: "number",
            description: "line offset to start reading from",
            required: false,
            default: 0,
        },
        {
            name: "limitLine",
            type: "number",
            description: "max number of lines to return",
            required: false,
            default: 2000,
        },
    ],
    customClass: new FsInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: FsInteraction
    ): Promise<any> => {
        const { path, offsetLine = 0, limitLine = 2000 } = inputs;

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "reading", path: fullPath });

        let raw: string;
        try {
            raw = await readFile(fullPath, { encoding: "utf-8" });
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file found at "${path}"`);
            if (err.code === "EISDIR") throw new Error(`"${path}" is a directory, not a file`);
            throw err;
        }

        const lines = toLines(raw);
        const { content, totalLines, startLine, endLine } = paginateLines(lines, offsetLine, limitLine);

        return {
            content,
            totalLines,
            startLine,
            endLine,
        };
    },
});

export default FsReadFileTool;
