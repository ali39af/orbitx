import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
    TodoCreateListTool,
    TodoCreateTaskTool,
    TodoRemoveTaskTool,
    TodoGetListTool,
    MCPClient,
    MCPConnection,
    MCPServer,
} from "../../../index.js";

describe("todo/remove-task", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let listId: string;
    let taskIds: string[];

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(TodoCreateListTool());
        mcpServer.registerTool(TodoCreateTaskTool());
        mcpServer.registerTool(TodoRemoveTaskTool());
        mcpServer.registerTool(TodoGetListTool());

        const list = await mcpClient.callTool("todo-create-list", { name: "Tasks" });
        listId = list.output.todoListId;
        const created = await mcpClient.callTool("todo-create-task", {
            list: listId,
            tasks: [{ name: "Keep me" }, { name: "Remove me" }],
        });
        taskIds = created.output.todoTaskIds;
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("TodoRemoveTaskTool: removes a task from its list", async () => {
        const result = await mcpClient.callTool("todo-remove-task", { tasks: [taskIds[1]] });
        assert.strictEqual(result.output.message, "success");

        const listResult = await mcpClient.callTool("todo-get-list", { list: listId });
        const names = listResult.output.tasks.map((t: any) => t.name);
        assert.deepStrictEqual(names, ["Keep me"]);
    });

    test("TodoRemoveTaskTool: removing an unknown task id is a no-op success, not an error", async () => {
        const result = await mcpClient.callTool("todo-remove-task", { tasks: ["0xdoesnotexist"] });

        assert.strictEqual(result.output.message, "success");
    });

    test("TodoRemoveTaskTool: a non-array tasks input is rejected", async () => {
        const result = await mcpClient.callTool("todo-remove-task", { tasks: "not-an-array" as any });

        assert.match(result.output.error, /tasks must be an array of task id strings/);
    });
});
