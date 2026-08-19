import { MCPCustomClass } from "../../core/mcp.js";

export type AgentEvent =
    | { type: "hired"; name: string }
    | { type: "prompted"; name: string; prompt: string }
    | { type: "reported"; name: string; reported: boolean; report: string };

/**
 * Shared custom interaction class for the agent-management tools. A
 * frontend can listen on getEvents() to show live status (e.g. "Hiring
 * backend-worker...", "backend-worker is working...") while the planner
 * hires and prompts worker agents.
 */
export class AgentInteraction extends MCPCustomClass {
    emitAgentEvent(event: AgentEvent) {
        this.getEvents().emit("agent", event);
    }
}

export default AgentInteraction;
