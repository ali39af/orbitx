import { copyFile, stat } from "fs/promises";
import { basename, join, resolve } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { PresentInteraction } from "./interaction.js";
import { ensurePresentFolder, listPresentFiles } from "./utils.js";

export const PresentAddTool = () => new MCPTool<PresentInteraction>({
    name: "present-add",
    description:
        "present a file to the user by copying it into the present folder so the host application can surface it (e.g. as a download link or preview). " +
        "the path MUST point to a single file, never a directory/folder — if you want to present a whole folder, zip it first (e.g. with the bash/shell tool) and pass the path to the resulting .zip file instead. " +
        "call this once per file you want to present; presenting multiple files just means calling present-add multiple times.",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the FILE to present (not a directory)",
            required: true,
        },
    ],
    customClass: new PresentInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: PresentInteraction
    ): Promise<any> => {
        const { path } = inputs;

        if (!path || typeof path !== "string") {
            throw new Error("path must be a non-empty string");
        }

        const sourcePath = resolve(process.cwd(), path);

        let sourceStat;
        try {
            sourceStat = await stat(sourcePath);
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file found at "${path}"`);
            throw err;
        }

        if (sourceStat.isDirectory()) {
            throw new Error(
                `"${path}" is a directory — presents must be files. zip the folder first and present the .zip file instead.`
            );
        }

        const presentFolder = await ensurePresentFolder();
        const destPath = join(presentFolder, basename(sourcePath));

        // Copy via Node's fs API only — never shell out for this, so the
        // present folder's contents are always exactly what was requested.
        await copyFile(sourcePath, destPath);

        const paths = await listPresentFiles();

        // Emitted AFTER the copy completes, so anything listening always
        // sees an up-to-date present folder the moment it's notified.
        customClass?.emitPresentEvent({ type: "presents-updated", paths });

        return {
            message: "success",
            path: destPath,
        };
    },
});

export default PresentAddTool;
