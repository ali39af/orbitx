import { MCPCustomClass } from "../../core/mcp.js";

export type QuestionAnswerEvent =
    | { type: "question-answer"; };

/**
 * Shared custom interaction class for all filesystem tools. A frontend can
 * listen on getEvents() to reflect live activity (e.g. "Reading file.ts...",
 * "Writing config.json...") while the agent works on disk.
 */
export class QuestionAnswerInteraction extends MCPCustomClass {
    emitQuestionAnswerEvent(event: QuestionAnswerEvent) {
        this.getEvents().emit("question-answer", event);
    }
}

export default QuestionAnswerInteraction;
