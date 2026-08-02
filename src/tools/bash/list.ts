import { MCPTool, type MCP } from "../../core/mcp.js";
import { listProcesses } from "./process-manager.js";

export const BashListTool = () => new MCPTool({
    name: "bash-list",
    description: "list every bash process launched so far (running or finished) with its status, so a still-running one can be checked on or terminated",
    inputs: [],
    execute: async (_envID: string, _inputs: Record<string, any>, _mcp?: MCP): Promise<any> => {
        const processes = listProcesses().map((p) => ({
            processId: p.id,
            command: p.command,
            cwd: p.cwd,
            status: p.status,
            exitCode: p.exitCode,
            startedAt: p.startedAt,
            endedAt: p.endedAt,
        }));

        return {
            processes,
        };
    },
});

export default BashListTool;
