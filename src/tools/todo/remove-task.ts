import { MCPTool, type MCP } from "../../core/mcp.js";
import { TodoInteraction } from "./interaction.js";
import { getTask, getList, setList, deleteTaskKey } from "./storage.js";

export const TodoRemoveTaskTool = () => new MCPTool<TodoInteraction>({
    name: "todo-remove-task",
    description: "remove one or more tasks by id",
    inputs: [
        {
            name: "tasks",
            type: "array",
            description: "array of todoTaskId to remove",
            required: true,
        },
    ],
    customClass: new TodoInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        mcp?: MCP,
        customClass?: TodoInteraction
    ): Promise<any> => {
        const { tasks } = inputs;

        if (!Array.isArray(tasks) || tasks.some((t) => typeof t !== "string")) {
            throw new Error("tasks must be an array of task id strings");
        }

        if (!mcp) {
            throw new Error("todo-remove-task requires an MCP context");
        }

        const affectedListIds = new Set<string>();

        for (const taskId of tasks as string[]) {
            const task = await getTask(mcp, taskId);
            if (task) affectedListIds.add(task.listId);
            await deleteTaskKey(mcp, taskId);
        }

        for (const listId of affectedListIds) {
            const list = await getList(mcp, listId);
            if (list) {
                list.taskIds = list.taskIds.filter((id) => !tasks.includes(id));
                await setList(mcp, list);
            }
        }

        customClass?.emitTodoEvent({ type: "task-removed", taskIds: tasks });

        return {
            message: "success",
        };
    },
});

export default TodoRemoveTaskTool;
