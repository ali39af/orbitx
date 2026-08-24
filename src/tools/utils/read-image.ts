import { readFile } from "fs/promises";
import { extname } from "path";
import { MCPTool } from "../../core/mcp.js";
import { resolvePath } from "../fs/utils.js";

const MIME_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
};

function mimeTypeForPath(path: string): string {
    return MIME_TYPES[extname(path).toLowerCase()] ?? "image/png";
}

/**
 * Reads an image straight off disk and hands it to the agent as an image
 * tool-output — same shape and same downstream handling as
 * `browser-screenshot` (see BaseAgent#resolveToolOutputForModel): depending
 * on how the agent is configured, the raw bytes go straight to the main
 * model, or a separate image-capable provider describes it first so the
 * main conversation doesn't have to carry image bytes.
 */
export const ReadImageTool = () => new MCPTool({
    name: "read-image",
    description:
        "read an image file from disk and hand it to the agent. works just like browser-screenshot: returns an image tool-output — depending on how the agent is configured, the raw image may be handed directly to the model, or first described by a separate image-capable AI so the main conversation doesn't have to carry image bytes. " +
        "use `focusHint` to tell that description step what you actually care about (e.g. 'read out any visible text' or 'check whether the chart trend is up or down'), so the resulting description is useful for your task instead of a generic caption.",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the image file (png, jpg, gif, webp, bmp)",
            required: true,
        },
        {
            name: "focusHint",
            type: "string",
            description: "what to focus on when describing the image",
            required: false,
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>): Promise<any> => {
        const { path, focusHint } = inputs;

        if (!path || typeof path !== "string") {
            throw new Error("path must be a non-empty string");
        }

        const fullPath = resolvePath(path);

        let image: string;
        try {
            image = (await readFile(fullPath)).toString("base64");
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no file found at "${path}"`);
            if (err.code === "EISDIR") throw new Error(`"${path}" is a directory, not a file`);
            throw err;
        }

        return {
            type: "image",
            output: {
                image,
                mimeType: mimeTypeForPath(fullPath),
                ...(focusHint ? { focusHint } : {}),
            },
        };
    },
});

export default ReadImageTool;
