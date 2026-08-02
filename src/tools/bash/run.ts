import { MCPTool, type MCP } from "../../core/mcp.js";
import { platform } from "os";
import { BashInteraction } from "./interaction.js";
import { spawnProcess } from "./process-manager.js";

export const BashRunTool = () => new MCPTool<BashInteraction>({
    name: "bash-run",
    description:
        "launch a shell command as a background process, returns its processId immediately. waits up to waitMs for it to finish; if it's still running after that (e.g. an endless process like `npm run dev`) it returns early with status \"running\" and the process keeps going in the background — use bash-wait or bash-logs to check on it later, and bash-terminate to stop it. if the process needs interactive input (e.g. a CLI prompt like \"please enter your project name:\"), use bash-write-input." + " your bash platform on os-type=" + platform(),
    inputs: [
        {
            name: "command",
            type: "string",
            description: "shell command to run",
            required: true,
        },
        {
            name: "cwd",
            type: "string",
            description: "working directory to run the command in (defaults to process cwd)",
            required: false,
        },
        {
            name: "waitMs",
            type: "number",
            description: "max milliseconds to wait for the process to finish before returning early",
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
        const { command, cwd, waitMs = 15000, tailLines = 20 } = inputs;

        if (!command || typeof command !== "string") {
            throw new Error("command must be a non-empty string");
        }

        const proc = spawnProcess(command, cwd);

        customClass?.emitBashEvent({ type: "process-started", processId: proc.id, command });

        await proc.waitFor(waitMs);

        if (proc.status !== "running") {
            customClass?.emitBashEvent({ type: "process-exited", processId: proc.id, exitCode: proc.exitCode });
        }

        return {
            processId: proc.id,
            status: proc.status,
            exitCode: proc.exitCode,
            logs: proc.getLastLines(tailLines).join("\n"),
        };
    },
});

export default BashRunTool;
