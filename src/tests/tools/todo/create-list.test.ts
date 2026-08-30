import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { TodoCreateListTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("todo/create-list", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoCreateListTool: creates a list and returns a non-empty todoListId", async () => {
        const result = await mcpClient.callTool("todo-create-list", { name: "Groceries" });

        assert.strictEqual(typeof result.output.todoListId, "string");
        assert.ok(result.output.todoListId.length > 0);
    });

    test("TodoCreateListTool: two calls return distinct ids", async () => {
        const first = await mcpClient.callTool("todo-create-list", { name: "List A" });
        const second = await mcpClient.callTool("todo-create-list", { name: "List B" });

        assert.notStrictEqual(first.output.todoListId, second.output.todoListId);
    });

    test("TodoCreateListTool: an empty name is rejected", async () => {
        const result = await mcpClient.callTool("todo-create-list", { name: "" });

        assert.match(result.output.error, /name must be a non-empty string/);
    });
});
