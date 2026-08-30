import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { TodoCreateListTool, TodoGetListsTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("todo/get-lists", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
        mcpServer.registerTool(TodoGetListsTool());
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoGetListsTool: returns an empty array when no lists have been created yet", async () => {
        const result = await mcpClient.callTool("todo-get-lists", {});

        assert.deepStrictEqual(result.output.lists, []);
    });

    test("TodoGetListsTool: reflects every list created so far", async () => {
        const a = await mcpClient.callTool("todo-create-list", { name: "A" });
        const b = await mcpClient.callTool("todo-create-list", { name: "B" });

        const result = await mcpClient.callTool("todo-get-lists", {});

        assert.deepStrictEqual(result.output.lists, [a.output.todoListId, b.output.todoListId]);
    });
});
