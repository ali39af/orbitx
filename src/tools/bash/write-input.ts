import { MCPTool, type MCP } from "../../core/mcp.js";
import { BashInteraction } from "./interaction.js";
import { writeToProcess, getProcess } from "./process-manager.js";

export const BashWriteInputTool = () => new MCPTool<BashInteraction>({
    name: "bash-write-input",
    description:
        "send text to a running process's stdin, e.g. to answer an interactive prompt like \"please enter your project name:\" or confirm a \"(y/n)\" question. a newline is appended by default so the process receives it as an ENTER keypress.",
    inputs: [
        {
            name: "processId",
            type: "string",
            description: "id of the process to write to",
            required: true,
        },
        {
            name: "text",
            type: "string",
            description: "text to send to stdin (e.g. \"my-project\" or \"y\")",
            required: true,
        },
        {
            name: "appendNewline",
            type: "boolean",
            description: "append a newline after text, simulating pressing ENTER",
            required: false,
            default: true,
        },
    ],
    customClass: new BashInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: BashInteraction
    ): Promise<any> => {
        const { processId, text, appendNewline = true } = inputs;

        if (!processId || typeof processId !== "string") {
            throw new Error("processId must be a non-empty string");
        }
        if (typeof text !== "string") {
            throw new Error("text must be a string");
        }

        writeToProcess(processId, text, appendNewline);

        customClass?.emitBashEvent({ type: "input-sent", processId });

        const proc = getProcess(processId);

        return {
            message: "success",
            status: proc.status,
        };
    },
});

export default BashWriteInputTool;
