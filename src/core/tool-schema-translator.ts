import type { ToolSchema } from "./ai-provider.js";

/**
 * Translates our standard, provider-agnostic ToolSchema[] into the
 * OpenAI-compatible `tools: [{type:"function", function:{...}}]` shape.
 * Both the OpenAI SDK (DeepSeekProvider) and Ollama's function-calling API
 * use this same shape, so it's shared rather than duplicated per provider.
 */
export function toOpenAIFunctionTools(tools: ToolSchema[]): any[] {
    return tools.map(t => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: {
                type: "object",
                properties: Object.fromEntries(t.inputs.map(i => [
                    i.name,
                    {
                        type: i.type === "array" ? "array" : i.type === "object" ? "object" : i.type,
                        description: i.description,
                        ...(i.default !== undefined ? { default: i.default } : {}),
                    }
                ])),
                required: t.inputs.filter(i => i.required).map(i => i.name),
            },
        },
    }));
}

export default toOpenAIFunctionTools;
