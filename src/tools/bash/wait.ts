import { MCPTool, type MCP } from "../../core/mcp.js";
import { BashInteraction } from "./interaction.js";
import { getProcess } from "./process-manager.js";

export const BashWaitTool = () => new MCPTool<BashInteraction>({
    name: "bash-wait",
    description:
        "wait up to waitMs for a previously started process to finish, then return its status and the last N lines of output (works the same as the initial wait in bash-run, useful for polling a long-running process again)",
    inputs: [
        {
            name: "processId",
            type: "string",
            description: "id of the process to wait on",
            required: true,
        },
        {
            name: "waitMs",
            type: "number",
            description: "max milliseconds to wait for the process to finish",
            required: false,
            default: 15000,
        },
        {
            name: "tailLines",
            type: "number",
            description: "number of most recent output lines to include in the response",
            required: false,
            default: 20,
        },
    ],
    customClass: new BashInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: BashInteraction
    ): Promise<any> => {
        const { processId, waitMs = 15000, tailLines = 20 } = inputs;

        if (!processId || typeof processId !== "string") {
            throw new Error("processId must be a non-empty string");
        }

        const proc = getProcess(processId);

        customClass?.emitBashEvent({ type: "waiting", processId });

        await proc.waitFor(waitMs);

        if (proc.status !== "running") {
            customClass?.emitBashEvent({ type: "process-exited", processId, exitCode: proc.exitCode });
        }

        return {
            processId: proc.id,
            status: proc.status,
            exitCode: proc.exitCode,
            logs: proc.getLastLines(tailLines).join("\n"),
        };
    },
});

export default BashWaitTool;
