import { MCPTool, type MCP } from "../../core/mcp.js";
import { TodoInteraction } from "./interaction.js";
import { getList, getListIndex, setListIndex, deleteListKey, deleteTaskKey } from "./storage.js";

export const TodoRemoveListTool = () => new MCPTool<TodoInteraction>({
    name: "todo-remove-list",
    description: "remove one or more todo lists (and all of their tasks)",
    inputs: [
        {
            name: "lists",
            type: "array",
            description: "array of todoListId to remove",
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
        const { lists } = inputs;

        if (!Array.isArray(lists) || lists.some((l) => typeof l !== "string")) {
            throw new Error("lists must be an array of list id strings");
        }

        if (!mcp) {
            throw new Error("todo-remove-list requires an MCP context");
        }

        for (const listId of lists as string[]) {
            const list = await getList(mcp, listId);
            if (list) {
                for (const taskId of list.taskIds) {
                    await deleteTaskKey(mcp, taskId);
                }
            }
            await deleteListKey(mcp, listId);
        }

        const index = await getListIndex(mcp);
        await setListIndex(mcp, index.filter((id) => !lists.includes(id)));

        customClass?.emitTodoEvent({ type: "list-removed", listIds: lists });

        return {
            message: "success",
        };
    },
});

export default TodoRemoveListTool;
