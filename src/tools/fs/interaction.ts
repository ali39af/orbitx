import { MCPCustomClass } from "../../core/mcp.js";

export type FsEvent =
    | { type: "reading"; path: string }
    | { type: "writing"; path: string }
    | { type: "editing"; path: string }
    | { type: "deleting"; path: string }
    | { type: "moving"; from: string; to: string }
    | { type: "listing"; path: string }
    | { type: "dir-created"; path: string }
    | { type: "stat"; path: string };

/**
 * Shared custom interaction class for all filesystem tools. A frontend can
 * listen on getEvents() to reflect live activity (e.g. "Reading file.ts...",
 * "Writing config.json...") while the agent works on disk.
 */
export class FsInteraction extends MCPCustomClass {
    emitFsEvent(event: FsEvent) {
        this.getEvents().emit("fs", event);
    }
}

export default FsInteraction;
