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

describe("todo/create-task", () => {
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
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoCreateTaskTool: creates tasks and returns one todoTaskId per task", async () => {
        const result = await mcpClient.callTool("todo-create-task", {
            list: listId,
            tasks: [{ name: "Buy milk" }, { name: "Buy eggs", description: "a dozen" }],
        });

        assert.strictEqual(result.output.todoTaskIds.length, 2);

        const listResult = await mcpClient.callTool("todo-get-list", { list: listId });
        const names = listResult.output.tasks.map((t: any) => t.name);
        assert.deepStrictEqual(names, ["Buy milk", "Buy eggs"]);
        assert.strictEqual(listResult.output.tasks[1].description, "a dozen");
        assert.strictEqual(listResult.output.tasks[0].checked, false);
    });

    test("TodoCreateTaskTool: an unknown list surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("todo-create-task", {
            list: "0xdoesnotexist",
            tasks: [{ name: "x" }],
        });

        assert.match(result.output.error, /no todo list found with id/);
    });

    test("TodoCreateTaskTool: an empty tasks array is rejected", async () => {
        const result = await mcpClient.callTool("todo-create-task", { list: listId, tasks: [] });

        assert.match(result.output.error, /tasks must be a non-empty array/);
    });

    test("TodoCreateTaskTool: a task without a name is rejected", async () => {
        const result = await mcpClient.callTool("todo-create-task", {
            list: listId,
            tasks: [{ description: "no name here" }],
        });

        assert.match(result.output.error, /every task requires a non-empty name/);
    });
});
