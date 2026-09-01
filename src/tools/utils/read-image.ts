import { readFile } from "fs/promises";
import { extname } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
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
 * Reads an image straight off disk and describes it itself, via
 * `mcp.executeProvider(toolCallId, "image-describer", { parts })` — works
 * identically whether this tool is registered directly on an `MCPClient` or
 * on a sandboxed/remote `MCPServer` (see `MCP#executeProvider` in mcp.ts). The
 * raw image bytes never leave this tool; only the resulting text
 * description is returned. Usage is recorded on the trusted side of that
 * call, not by this tool — see `BaseAgent#executeProvider`. `parts` (not a
 * plain `content` string) is what actually reaches the provider as a real
 * image — every built-in `AIProvider` only builds a multimodal image block
 * from `Message.parts`, so a base64 string folded into `content` would be
 * sent as literal text instead.
 */
export const ReadImageTool = () => new MCPTool({
    name: "read-image",
    description:
        "read an image file from disk and get back a text description of it. " +
        "use `focusHint` to tell the description step what you actually care about (e.g. 'read out any visible text' or 'check whether the chart trend is up or down'), so the resulting description is useful for your task instead of a generic caption.",
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
    execute: async (_envID: string, inputs: Record<string, any>, toolCallId?: string, mcp?: MCP): Promise<any> => {
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

        if (!mcp || !toolCallId) {
            throw new Error("read-image requires an MCP context");
        }

        const instruction = focusHint
            ? `Describe this image concisely for another AI agent that cannot see it. Focus specifically on: ${focusHint}`
            : "Describe this image concisely for another AI agent that cannot see it. Mention layout, visible text, colors, and anything that looks unusual or broken.";

        const { output } = await mcp.executeProvider(toolCallId, "image-describer", {
            parts: [
                { type: "text", text: instruction },
                { type: "image", image, mimeType: mimeTypeForPath(fullPath) },
            ],
        });

        return { description: output.content };
    },
});

export default ReadImageTool;
