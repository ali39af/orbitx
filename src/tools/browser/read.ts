import { MCPTool, type MCP } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";
import { readPage } from "./read-page.js";

export const BrowserReadTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-read",
    description:
        "read the current page as a readable text outline (headings, paragraphs, tables, links, inputs, buttons, images, and forms), assigning a ref id to every clickable/fillable element for use with browser-click / browser-fill. " +
        "forms are shown with their own ref, and any fillable field with no visible submit button nearby is flagged so you know pressing Enter (or browser-submit-form) is required to submit it. " +
        "if the outline is too long to fit in one response, the output is truncated and a `ref` is returned — call this tool again with `continueRef` set to that value (and a new `offsetLine`) to keep reading the SAME captured snapshot without generating new element refs. " +
        "do not pass `continueRef` on your first read of a page, or after the page has navigated/changed — only use it to keep paging through output you already started reading.",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to read",
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
            default: 200,
        },
        {
            name: "continueRef",
            type: "string",
            description: "ref id returned by a previous browser-read call whose output was truncated; continues paging through that same snapshot instead of re-reading the live page",
            required: false,
        },
    ],
    customClass: new BrowserInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        mcp?: MCP,
        customClass?: BrowserInteraction
    ): Promise<any> => {
        const { sessionId, offsetLine = 0, limitLine = 200, continueRef } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        customClass?.emitBrowserEvent({ type: "reading", sessionId });

        const session = getSession(sessionId);
        const result = await readPage(mcp, session, offsetLine, limitLine, continueRef);

        return {
            content: result.content,
            totalLines: result.totalLines,
            ref: result.ref,
        };
    },
});

export default BrowserReadTool;
