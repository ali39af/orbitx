import { mkdir } from "fs/promises";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

export const FsCreateDirTool = () => new MCPTool<FsInteraction>({
    name: "fs-create-dir",
    description: "create a directory, including any missing parent directories",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the directory to create",
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

        customClass?.emitFsEvent({ type: "dir-created", path: fullPath });

        await mkdir(fullPath, { recursive: true });

        return {
            message: "success",
        };
    },
});

export default FsCreateDirTool;
