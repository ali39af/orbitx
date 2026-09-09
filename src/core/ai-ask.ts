import type { AgentProvidersInput } from "./agent-providers.js";
import type { MessageUsage } from "./ai-provider.js";
import MCPTool from "./mcp.js";
import MCPClient from "./mcp-client.js";
import MCPConnection from "./mcp-connection.js";
import MCPServer from "./mcp-server.js";
import { StatelessAgent } from "./stateless-agent.js";

export interface AIAskOutputField {
    name: string;
    type: "number" | "string" | "boolean" | "object" | "array";
    description: string;
    required?: boolean;
}

export type AIAskOutputStructure = AIAskOutputField[];

export interface AIAskProps {
    instruction: string;
    aiModel: AgentProvidersInput;
    outputStructure: AIAskOutputStructure;
}

export interface AIAskResult {
    output: Record<string, any>;
    valid: boolean;
    errors?: string[];
    attempts: number;
    usage: MessageUsage[];
}

const OUTPUT_TOOL_NAME = "submit_answer";
const MAX_ATTEMPTS = 3;

function validate(output: Record<string, any>, structure: AIAskOutputStructure): string[] {
    const errors: string[] = [];
    for (const field of structure) {
        const value = output[field.name];
        if (value === undefined) {
            if (field.required !== false) errors.push(`missing required field "${field.name}"`);
            continue;
        }
        const matches = field.type === "array" ? Array.isArray(value)
            : field.type === "object" ? (typeof value === "object" && value !== null && !Array.isArray(value))
            : typeof value === field.type;
        if (!matches) {
            errors.push(`field "${field.name}" should be ${field.type}, got ${Array.isArray(value) ? "array" : typeof value}`);
        }
    }
    return errors;
}

export class AIASK {
    #instruction: string;
    #aiModel: AgentProvidersInput;
    #outputStructure: AIAskOutputStructure;

    constructor({ instruction, aiModel, outputStructure }: AIAskProps) {
        this.#instruction = instruction;
        this.#aiModel = aiModel;
        this.#outputStructure = outputStructure;
    }

    async run(input: string): Promise<AIAskResult> {
        let captured: Record<string, any> | undefined;

        const submitTool = new MCPTool({
            name: OUTPUT_TOOL_NAME,
            description: "Submit your final answer in the exact structure requested. Call this exactly once you have the answer — do not reply in plain text.",
            inputs: this.#outputStructure.map(f => ({ name: f.name, type: f.type, description: f.description, required: f.required })),
            execute: async (_envID, inputs) => {
                captured = inputs;
                return inputs;
            },
        });

        const conn = new MCPConnection();
        const mcpServer = new MCPServer(conn);
        mcpServer.registerTool(submitTool);
        const mcpClient = new MCPClient("AI_ASK", conn);

        const agent = new StatelessAgent({
            instruction: this.#instruction,
            aiProvider: this.#aiModel,
            mcpClient,
            allowedTools: [submitTool],
        });

        const usage: MessageUsage[] = [];
        let errors: string[] = [];
        let lastOutput: Record<string, any> = {};

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            captured = undefined;

            const prompt = errors.length === 0
                ? input
                : `${input}\n\nYour previous "${OUTPUT_TOOL_NAME}" call was rejected:\n${errors.map(e => `- ${e}`).join("\n")}\n\nCall "${OUTPUT_TOOL_NAME}" again with a corrected answer.`;

            const result = await agent.run(prompt);
            usage.push(...result.usage);

            if (captured === undefined) {
                errors = [`"${OUTPUT_TOOL_NAME}" was not called — replied with plain text instead: ${JSON.stringify(result.content)}`];
                continue;
            }

            lastOutput = captured;
            errors = validate(captured, this.#outputStructure);

            if (errors.length === 0) {
                return { output: lastOutput, valid: true, attempts: attempt, usage };
            }
        }

        return { output: lastOutput, valid: false, errors, attempts: MAX_ATTEMPTS, usage };
    }
}

export default AIASK;
