import { MCPTool, type MCP } from "../../core/mcp.js";
import { getProcess } from "./process-manager.js";

export const BashLogsTool = () => new MCPTool({
    name: "bash-logs",
    description:
        "read a process's combined stdout/stderr log, paging through it by line (use offsetLine/limitLine for long logs instead of tailLines from bash-run/bash-wait)",
    inputs: [
        {
            name: "processId",
            type: "string",
            description: "id of the process to read logs from",
            required: true,
        },
        {
            name: "offsetLine",
            type: "number",
            description: "line offset to start reading from",
            required: false,
            default: 0,
        },
        {
            name: "limitLine",
            type: "number",
            description: "max number of lines to return",
            required: false,
            default: 200,
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>, _mcp?: MCP): Promise<any> => {
        const { processId, offsetLine = 0, limitLine = 200 } = inputs;

        if (!processId || typeof processId !== "string") {
            throw new Error("processId must be a non-empty string");
        }

        const proc = getProcess(processId);
        const lines = proc.getAllLines();
        const totalLines = lines.length;
        const start = Math.max(0, Math.min(offsetLine, totalLines));
        const end = Math.max(start, Math.min(start + limitLine, totalLines));

        return {
            content: lines.slice(start, end).join("\n"),
            totalLines,
            status: proc.status,
            exitCode: proc.exitCode,
        };
    },
});

export default BashLogsTool;
