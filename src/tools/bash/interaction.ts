import { MCPCustomClass } from "../../core/mcp.js";

export type BashEvent =
    | { type: "process-started"; processId: string; command: string }
    | { type: "waiting"; processId: string }
    | { type: "input-sent"; processId: string }
    | { type: "terminated"; processId: string }
    | { type: "process-exited"; processId: string; exitCode: number | null };

/**
 * Shared custom interaction class for all bash tools. A frontend can listen
 * on getEvents() to reflect live process activity (e.g. "Running npm run
 * dev...", "Waiting for build to finish...") without polling.
 */
export class BashInteraction extends MCPCustomClass {
    emitBashEvent(event: BashEvent) {
        this.getEvents().emit("bash", event);
    }
}

export default BashInteraction;
