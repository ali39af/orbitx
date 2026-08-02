import { readFile, writeFile } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath, toLines } from "./utils.js";

export const FsEditFileTool = () => new MCPTool<FsInteraction>({
    name: "fs-edit-file",
    description:
        "replace a specific line range in an existing file without rewriting the whole file. lines are 0-indexed; the range [offsetLine, offsetLine+limitLine) is replaced entirely by `content` (use limitLine 0 to insert at offsetLine without deleting anything). read the file first (fs-read-file) to get accurate line numbers, since another edit may have shifted them.",
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
            description: "0-indexed line to start replacing from",
            required: true,
        },
        {
            name: "limitLine",
            type: "number",
            description: "number of existing lines to remove starting at offsetLine",
            required: true,
        },
        {
            name: "content",
            type: "string",
            description: "text to insert in place of the removed lines (may itself contain newlines, or be empty to just delete)",
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
        const { path, offsetLine, limitLine, content } = inputs;

        if (typeof offsetLine !== "number" || offsetLine < 0) {
            throw new Error("offsetLine must be a non-negative number");
        }
        if (typeof limitLine !== "number" || limitLine < 0) {
            throw new Error("limitLine must be a non-negative number");
        }
        if (typeof content !== "string") {
            throw new Error("content must be a string");
        }

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "editing", path: fullPath });

        let raw: string;
        try {
            raw = await readFile(fullPath, { encoding: "utf-8" });
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file found at "${path}"`);
            throw err;
        }

        const lines = toLines(raw);

        if (offsetLine > lines.length) {
            throw new Error(`offsetLine ${offsetLine} is past end of file (${lines.length} lines)`);
        }

        const removedCount = Math.min(limitLine, lines.length - offsetLine);
        const insertedLines = content.length === 0 ? [] : content.split(/\r\n|\r|\n/);

        lines.splice(offsetLine, removedCount, ...insertedLines);

        await writeFile(fullPath, lines.join("\n"), { encoding: "utf-8" });

        return {
            message: "success",
            removedLines: removedCount,
            insertedLines: insertedLines.length,
            totalLines: lines.length,
        };
    },
});

export default FsEditFileTool;
