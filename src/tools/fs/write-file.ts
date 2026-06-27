import MCPTool from "../../core/mcp";
import fs from "fs/promises";
import path from "path";

export const WriteFileTool = new MCPTool({
    name: "write-file",
    description: "Writes text content to a file at the specified path. Creates new file or overwrites existing.",
    inputs: [{
        name: "filePath",
        type: "string",
        description: `Absolute or relative path to the file (e.g., "/home/user/doc.txt" or "./file.txt")`,
        required: true,
    },
    {
        name: "data",
        type: "string",
        description: "Text content to write (supports multi-line)",
        required: true,
    }],
    execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
        try {
            const { filePath, data } = inputs;

            if (!filePath || typeof filePath !== "string") {
                throw new Error("filePath must be a non-empty string");
            }

            if (typeof data !== "string") {
                throw new Error("data must be a string");
            }

            const normalizedPath = path.normalize(filePath);

            const dir = path.dirname(normalizedPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(normalizedPath, data, "utf-8");

            return {
                message: `File written: ${normalizedPath}`,
                path: normalizedPath,
                size: data.length
            };

        } catch (error) {
            let errorMessage = error instanceof Error ? error.message : String(error);

            if (error instanceof Error && "code" in error) {
                const err = error as NodeJS.ErrnoException;

                if (err.code === "EACCES") {
                    errorMessage = `Permission denied: Cannot write to ${inputs.filePath}`;
                } else if (err.code === "ENOENT") {
                    errorMessage = `Directory does not exist or cannot be created: ${path.dirname(inputs.filePath)}`;
                } else if (err.code === "EISDIR") {
                    errorMessage = `Path is a directory, cannot write file: ${inputs.filePath}`;
                } else if (err.code === "ENOSPC") {
                    errorMessage = `No space left on device: Cannot write to ${inputs.filePath}`;
                } else if (err.code === "EROFS") {
                    errorMessage = `Read-only file system: Cannot write to ${inputs.filePath}`;
                } else if (err.code === "ENAMETOOLONG") {
                    errorMessage = `File path is too long: ${inputs.filePath}`;
                }
            }

            return {
                error: errorMessage
            };
        }
    }
});

export default WriteFileTool;