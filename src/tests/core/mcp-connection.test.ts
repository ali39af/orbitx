import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GetCurrentTimeTool, MCPClient, MCPConnection, MCPServer } from "../../index.js";


let mcpConnection: MCPConnection | undefined;
let mcpClient: MCPClient;
let mcpServer: MCPServer;

before(async () => {
    mcpConnection = new MCPConnection();
    mcpClient = new MCPClient("1234", mcpConnection);
    mcpServer = new MCPServer(mcpConnection);
    mcpServer.registerTool(GetCurrentTimeTool());
});

after(async () => {
    mcpConnection?.close();
});

test("MCPConnection: get-current-time tool call returns iso, unix, and timezone fields", async () => {
    const result = await mcpClient.callTool("get-current-time", {});

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    assert.ok("iso" in output, "output should contain 'iso'");
    assert.ok("unix" in output, "output should contain 'unix'");
    assert.ok("timezone" in output, "output should contain 'timezone'");
});