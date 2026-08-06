import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GetCurrentTimeTool, MCPClient, MCPConnection, MCPWSConnection, MCPServer } from "../../index.js";
import { platform } from "node:os";


let mcpClientWSConnection: MCPConnection | undefined;
let mcpServerWSConnection: MCPConnection | undefined;
let mcpClient: MCPClient;
let mcpServer: MCPServer;

before(async () => {
    mcpServerWSConnection = new MCPWSConnection({
        mode: "server",
        host: "0.0.0.0",
        port: 6785
    });
    mcpClientWSConnection = new MCPWSConnection({
        mode: "client",
        url: "ws://localhost:6785"
    });
    mcpClient = new MCPClient("1234", mcpClientWSConnection);
    mcpServer = new MCPServer(mcpServerWSConnection);
    mcpServer.registerTool(GetCurrentTimeTool());
});

after(async () => {
    mcpClientWSConnection?.close();
    mcpServerWSConnection?.close();
});

test("MCPWSConnection: get-current-time tool call returns iso, unix, and timezone fields", async () => {
    const result = await mcpClient.callTool("get-current-time", {});

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    assert.ok("iso" in output, "output should contain 'iso'");
    assert.ok("unix" in output, "output should contain 'unix'");
    assert.ok("timezone" in output, "output should contain 'timezone'");
});