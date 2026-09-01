import { MCPTool, generateRefId, type MCP } from "../../core/mcp.js";
import { getList, setList, setTask } from "./storage.js";

export const TodoCreateTaskTool = () => new MCPTool({
    name: "todo-create-task",
    description: "create one or more tasks inside a todo list, returns their todoTaskIds",
    inputs: [
        {
            name: "list",
            type: "string",
            description: "todoListId to add the tasks to",
            required: true,
        },
        {
            name: "tasks",
            type: "array",
            description: "array of {name, description?} objects to create",
            required: true,
        },
    ],
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _toolCallId?: string,
        mcp?: MCP
    ): Promise<any> => {
        const { list, tasks } = inputs;

        if (!list || typeof list !== "string") {
            throw new Error("list must be a non-empty string");
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
            throw new Error("tasks must be a non-empty array of {name, description?} objects");
        }

        for (const t of tasks) {
            if (!t || typeof t.name !== "string" || !t.name) {
                throw new Error("every task requires a non-empty name:string");
            }
        }

        if (!mcp) {
            throw new Error("todo-create-task requires an MCP context");
        }

        const todoList = await getList(mcp, list);
        if (!todoList) {
            throw new Error(`no todo list found with id "${list}"`);
        }

        const todoTaskIds: string[] = [];

        for (const t of tasks) {
            const taskId = await generateRefId(mcp);
            await setTask(mcp, {
                id: taskId,
                listId: list,
                name: t.name,
                description: typeof t.description === "string" ? t.description : undefined,
                checked: false,
            });
            todoTaskIds.push(taskId);
        }

        todoList.taskIds.push(...todoTaskIds);
        await setList(mcp, todoList);

        return {
            todoTaskIds,
        };
    },
});

export default TodoCreateTaskTool;
