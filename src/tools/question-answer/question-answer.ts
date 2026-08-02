import { MCPTool, type MCP } from "../../core/mcp.js";
import QuestionAnswerInteraction from "./interaction.js";

export const QuestionAnswerTool = () => new MCPTool<QuestionAnswerInteraction>({
    name: "question-answer",
    description: "when you want ask some questions before continue doing task",
    inputs: [
        {
            name: "questions",
            type: "array",
            description: "array of {question, predefinedAnswer?: string[]} objects to create",
            required: true,
        },
    ],
    stopIterationAfterUsingThisTool: true,
    customClass: new QuestionAnswerInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: QuestionAnswerInteraction
    ): Promise<any> => {
        
        customClass?.emitQuestionAnswerEvent({ type: "question-answer" });

        return {
            message: "success",
        };
    },
});

export default QuestionAnswerTool;
