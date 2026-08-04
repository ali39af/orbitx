import type { ToolSchema } from "./ai-provider.js";

/**
 * Translates our standard, provider-agnostic ToolSchema[] into the
 * OpenAI-compatible `tools: [{type:"function", function:{...}}]` shape.
 * Both the OpenAI SDK (DeepSeekProvider, OpenAIProvider) and Ollama's
 * function-calling API use this same shape, so it's shared rather than
 * duplicated per provider.
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

/**
 * Translates our standard, provider-agnostic ToolSchema[] into Anthropic's
 * `tools: [{name, description, input_schema:{...}}]` shape. Anthropic uses
 * a flat JSON-Schema `input_schema` rather than OpenAI's nested
 * `function.parameters`, so this can't reuse toOpenAIFunctionTools — kept
 * as its own function but mirroring the same property-bag construction for
 * consistency with the OpenAI-shape translator above.
 */
export function toAnthropicTools(tools: ToolSchema[]): any[] {
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: {
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
    }));
}

export default toOpenAIFunctionTools;