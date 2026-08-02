import { MCPTool, generateRefId, type MCP } from "../../core/mcp.js";
import { TodoInteraction } from "./interaction.js";
import { getListIndex, setListIndex, setList } from "./storage.js";

export const TodoCreateListTool = () => new MCPTool<TodoInteraction>({
    name: "todo-create-list",
    description: "create a new todo list, returns its todoListId",
    inputs: [
        {
            name: "name",
            type: "string",
            description: "display name of the list",
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
        const { name } = inputs;

        if (!name || typeof name !== "string") {
            throw new Error("name must be a non-empty string");
        }

        if (!mcp) {
            throw new Error("todo-create-list requires an MCP context");
        }

        const todoListId = await generateRefId(mcp);

        await setList(mcp, { id: todoListId, name, taskIds: [] });

        const index = await getListIndex(mcp);
        index.push(todoListId);
        await setListIndex(mcp, index);

        customClass?.emitTodoEvent({ type: "list-created", listId: todoListId, name });

        return {
            todoListId,
        };
    },
});

export default TodoCreateListTool;
