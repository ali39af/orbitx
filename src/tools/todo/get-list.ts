import { MCPTool, type MCP } from "../../core/mcp.js";
import { getList, getTask } from "./storage.js";

export const TodoGetListTool = () => new MCPTool({
    name: "todo-get-list",
    description: "get all tasks belonging to a todo list",
    inputs: [
        {
            name: "list",
            type: "string",
            description: "todoListId to read",
            required: true,
        },
    ],
    execute: async (_envID: string, inputs: Record<string, any>, mcp?: MCP): Promise<any> => {
        const { list } = inputs;

        if (!list || typeof list !== "string") {
            throw new Error("list must be a non-empty string");
        }

        if (!mcp) {
            throw new Error("todo-get-list requires an MCP context");
        }

        const todoList = await getList(mcp, list);

        if (!todoList) {
            throw new Error(`no todo list found with id "${list}"`);
        }

        const tasks = [];
        for (const taskId of todoList.taskIds) {
            const task = await getTask(mcp, taskId);
            if (task) tasks.push(task);
        }

        return {
            tasks,
        };
    },
});

export default TodoGetListTool;
