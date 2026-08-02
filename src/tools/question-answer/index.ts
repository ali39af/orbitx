import { QuestionAnswerTool } from "./question-answer.js";

export { QuestionAnswerTool } from "./question-answer.js"
export { QuestionAnswerInteraction } from "./interaction.js"
export type { QuestionAnswerEvent } from "./interaction.js"

export const QuestionAnswerTools = () => [
    QuestionAnswerTool()
];