import { MCPCustomClass } from "../../core/mcp.js";

export type BrowserEvent =
    | { type: "session-created"; sessionId: string; url: string }
    | { type: "session-removed"; sessionId: string }
    | { type: "navigating"; sessionId: string; url: string }
    | { type: "reading"; sessionId: string }
    | { type: "clicking"; sessionId: string; ref: string }
    | { type: "filling"; sessionId: string; ref: string }
    | { type: "submitting-form"; sessionId: string; formRef: string }
    | { type: "scrolling"; sessionId: string; position: number }
    | { type: "injecting"; sessionId: string }
    | { type: "screenshotting"; sessionId: string };

/**
 * Shared custom interaction class for all browser tools. A frontend can
 * listen on getEvents() to show live status (e.g. "Searching...",
 * "Navigating to example.com...", "Clicking button...") while the agent
 * drives the browser, without waiting for the tool call itself to resolve.
 */
export class BrowserInteraction extends MCPCustomClass {
    emitBrowserEvent(event: BrowserEvent) {
        this.getEvents().emit("browser", event);
    }
}

export default BrowserInteraction;
