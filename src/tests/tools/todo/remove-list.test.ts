import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
    TodoCreateListTool,
    TodoCreateTaskTool,
    TodoRemoveListTool,
    TodoGetListsTool,
    TodoGetListTool,
    MCPClient,
    MCPConnection,
    MCPServer,
} from "../../../index.js";

describe("todo/remove-list", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
        mcpServer.registerTool(TodoCreateTaskTool());
        mcpServer.registerTool(TodoRemoveListTool());
        mcpServer.registerTool(TodoGetListsTool());
        mcpServer.registerTool(TodoGetListTool());
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoRemoveListTool: removes a list (and its tasks), no longer reachable afterwards", async () => {
        const list = await mcpClient.callTool("todo-create-list", { name: "To remove" });
        const listId = list.output.todoListId;
        await mcpClient.callTool("todo-create-task", { list: listId, tasks: [{ name: "Task" }] });

        const result = await mcpClient.callTool("todo-remove-list", { lists: [listId] });
        assert.strictEqual(result.output.message, "success");

        const lists = await mcpClient.callTool("todo-get-lists", {});
        assert.ok(!lists.output.lists.includes(listId));

        const getResult = await mcpClient.callTool("todo-get-list", { list: listId });
        assert.match(getResult.output.error, /no todo list found with id/);
    });

    test("TodoRemoveListTool: removing an unknown list id is a no-op success, not an error", async () => {
        const result = await mcpClient.callTool("todo-remove-list", { lists: ["0xdoesnotexist"] });

        assert.strictEqual(result.output.message, "success");
    });

    test("TodoRemoveListTool: a non-array lists input is rejected", async () => {
        const result = await mcpClient.callTool("todo-remove-list", { lists: "not-an-array" as any });

        assert.match(result.output.error, /lists must be an array of list id strings/);
    });
});
