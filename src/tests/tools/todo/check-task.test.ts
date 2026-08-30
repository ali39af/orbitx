import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
    TodoCreateListTool,
    TodoCreateTaskTool,
    TodoCheckTaskTool,
    TodoGetListTool,
    MCPClient,
    MCPConnection,
    MCPServer,
} from "../../../index.js";

describe("todo/check-task", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let listId: string;
    let taskId: string;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
        mcpServer.registerTool(TodoCreateTaskTool());
        mcpServer.registerTool(TodoCheckTaskTool());
        mcpServer.registerTool(TodoGetListTool());

        const list = await mcpClient.callTool("todo-create-list", { name: "Tasks" });
        listId = list.output.todoListId;
        const created = await mcpClient.callTool("todo-create-task", { list: listId, tasks: [{ name: "Task 1" }] });
        taskId = created.output.todoTaskIds[0];
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoCheckTaskTool: checking a task marks it checked", async () => {
        const result = await mcpClient.callTool("todo-check-task", { tasks: [taskId], check: true });
        assert.strictEqual(result.output.message, "success");

        const listResult = await mcpClient.callTool("todo-get-list", { list: listId });
        assert.strictEqual(listResult.output.tasks[0].checked, true);
    });

    test("TodoCheckTaskTool: unchecking a task marks it unchecked again", async () => {
        await mcpClient.callTool("todo-check-task", { tasks: [taskId], check: false });

        const listResult = await mcpClient.callTool("todo-get-list", { list: listId });
        assert.strictEqual(listResult.output.tasks[0].checked, false);
    });

    test("TodoCheckTaskTool: a non-boolean check value is rejected", async () => {
        const result = await mcpClient.callTool("todo-check-task", { tasks: [taskId], check: "yes" as any });

        assert.match(result.output.error, /check must be a boolean/);
    });
});
