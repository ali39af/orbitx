import { MCPTool, type MCP } from "../../core/mcp.js";
import { getListIndex } from "./storage.js";

export const TodoGetListsTool = () => new MCPTool({
    name: "todo-get-lists",
    description: "get all existing todo list ids",
    inputs: [],
    execute: async (_envID: string, _inputs: Record<string, any>, mcp?: MCP): Promise<any> => {
        if (!mcp) {
            throw new Error("todo-get-lists requires an MCP context");
        }

        const lists = await getListIndex(mcp);

        return {
            lists,
        };
    },
});

export default TodoGetListsTool;
