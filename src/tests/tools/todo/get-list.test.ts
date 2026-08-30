import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
    TodoCreateListTool,
    TodoCreateTaskTool,
    TodoGetListTool,
    MCPClient,
    MCPConnection,
    MCPServer,
} from "../../../index.js";

describe("todo/get-list", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let listId: string;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
        mcpServer.registerTool(TodoCreateTaskTool());
        mcpServer.registerTool(TodoGetListTool());

        const list = await mcpClient.callTool("todo-create-list", { name: "Tasks" });
        listId = list.output.todoListId;
        await mcpClient.callTool("todo-create-task", { list: listId, tasks: [{ name: "Task 1" }] });
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoGetListTool: returns every task belonging to the list", async () => {
        const result = await mcpClient.callTool("todo-get-list", { list: listId });

        assert.strictEqual(result.output.tasks.length, 1);
        assert.strictEqual(result.output.tasks[0].name, "Task 1");
        assert.strictEqual(result.output.tasks[0].listId, listId);
    });

    test("TodoGetListTool: an unknown list surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("todo-get-list", { list: "0xdoesnotexist" });

        assert.match(result.output.error, /no todo list found with id/);
    });

    test("TodoGetListTool: an empty list string is rejected", async () => {
        const result = await mcpClient.callTool("todo-get-list", { list: "" });

        assert.match(result.output.error, /list must be a non-empty string/);
    });
});
