import { MCPTool, type MCP } from "../../core/mcp.js";
import { BashInteraction } from "./interaction.js";
import { terminateProcess, getProcess } from "./process-manager.js";

export const BashTerminateTool = () => new MCPTool<BashInteraction>({
    name: "bash-terminate",
    description: "terminate a running process (e.g. stop an endless `npm run dev` once it's no longer needed)",
    inputs: [
        {
            name: "processId",
            type: "string",
            description: "id of the process to terminate",
            required: true,
        },
        {
            name: "force",
            type: "boolean",
            description: "use SIGKILL instead of SIGTERM for an immediate, non-graceful stop",
            required: false,
            default: false,
        },
    ],
    customClass: new BashInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: BashInteraction
    ): Promise<any> => {
        const { processId, force = false } = inputs;

        if (!processId || typeof processId !== "string") {
            throw new Error("processId must be a non-empty string");
        }

        terminateProcess(processId, force ? "SIGKILL" : "SIGTERM");

        const proc = getProcess(processId);
        await proc.waitFor(3000);

        customClass?.emitBashEvent({ type: "terminated", processId });

        return {
            message: "success",
            status: proc.status,
        };
    },
});

export default BashTerminateTool;
