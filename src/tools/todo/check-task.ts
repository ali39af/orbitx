import { MCPTool, type MCP } from "../../core/mcp.js";
import { getTask, setTask } from "./storage.js";

export const TodoCheckTaskTool = () => new MCPTool({
    name: "todo-check-task",
    description: "set the checked state of one or more tasks",
    inputs: [
        {
            name: "tasks",
            type: "array",
            description: "array of todoTaskId to update",
            required: true,
        },
        {
            name: "check",
            type: "boolean",
            description: "true to check the tasks, false to uncheck them",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        mcp?: MCP
    ): Promise<any> => {
        const { tasks, check } = inputs;

        if (!Array.isArray(tasks) || tasks.some((t) => typeof t !== "string")) {
            throw new Error("tasks must be an array of task id strings");
        }

        if (typeof check !== "boolean") {
            throw new Error("check must be a boolean");
        }

        if (!mcp) {
            throw new Error("todo-check-task requires an MCP context");
        }

        const updated: string[] = [];

        for (const taskId of tasks as string[]) {
            const task = await getTask(mcp, taskId);
            if (!task) continue;
            task.checked = check;
            await setTask(mcp, task);
            updated.push(taskId);
        }

        return {
            message: "success",
        };
    },
});

export default TodoCheckTaskTool;
