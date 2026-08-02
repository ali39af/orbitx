import { MCPCustomClass } from "../../core/mcp.js";

export type PresentEvent =
    | { type: "presents-updated"; paths: string[] };

/**
 * Shared custom interaction class for all present tools. A frontend can
 * listen on getEvents() to know the instant the set of presented files
 * changes (a new file was added, or everything was cleared) so it can
 * re-render whatever "here's the output" panel it shows the user, without
 * polling the present folder itself.
 */
export class PresentInteraction extends MCPCustomClass {
    emitPresentEvent(event: PresentEvent) {
        this.getEvents().emit("present", event);
    }
}

export default PresentInteraction;
