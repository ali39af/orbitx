import MCPTool from "../../core/mcp.js";
import fs from "fs/promises";
import path from "path";

export const ReadFileTool = new MCPTool({
    name: "read-file",
    description: "Reads text content from a file at the specified path.",
    inputs: [{
        name: "filePath",
        type: "string",
        description: `Absolute or relative path to the file (e.g., "/home/user/doc.txt" or "./file.txt")`,
        required: true,
    }],
    execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
        try {
            const { filePath } = inputs;

            if (!filePath || typeof filePath !== "string") {
                throw new Error("filePath must be a non-empty string");
            }

            const normalizedPath = path.normalize(filePath);

            const data = await fs.readFile(normalizedPath, "utf-8");

            return {
                message: `File read successfully: ${normalizedPath}`,
                path: normalizedPath,
                content: data,
                size: data.length
            };

        } catch (error) {
            let errorMessage = error instanceof Error ? error.message : String(error);

            if (error instanceof Error && "code" in error) {
                const err = error as NodeJS.ErrnoException;
                if (err.code === "ENOENT") {
                    errorMessage = `File not found: ${inputs.filePath}`;
                } else if (err.code === "EACCES") {
                    errorMessage = `Permission denied: ${inputs.filePath}`;
                } else if (err.code === "EISDIR") {
                    errorMessage = `Path is a directory, not a file: ${inputs.filePath}`;
                }
            }

            return {
                error: errorMessage
            };
        }
    }
});

export default ReadFileTool;