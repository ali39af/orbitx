import { MCPTool, type MCP } from "../../core/mcp.js";

export const QuestionAnswerTool = () => new MCPTool({
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
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        _mcp?: MCP
    ): Promise<any> => {
        
        return {
            message: "success",
        };
    },
});

export default QuestionAnswerTool;
