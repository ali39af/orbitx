import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GetCurrentTimeTool, MCPClient, MCPConnection, MCPIPCConnection, MCPServer } from "../../index.js";
import { platform } from "node:os";


let mcpClientIPCConnection: MCPConnection | undefined;
let mcpServerIPCConnection: MCPConnection | undefined;
let mcpClient: MCPClient;
let mcpServer: MCPServer;

before(async () => {
    mcpServerIPCConnection = new MCPIPCConnection({
        mode: "server",
        socketPath: platform() == "win32" ? "\\\\.\\pipe\\mcp_test" : "/tmp/mcp_test.sock"
    });
    mcpClientIPCConnection = new MCPIPCConnection({
        mode: "client",
        socketPath: platform() == "win32" ? "\\\\.\\pipe\\mcp_test" : "/tmp/mcp_test.sock"
    });
    mcpClient = new MCPClient("1234", mcpClientIPCConnection);
    mcpServer = new MCPServer(mcpServerIPCConnection);
    mcpServer.registerTool(GetCurrentTimeTool());
});

after(async () => {
    mcpClientIPCConnection?.close();
    mcpServerIPCConnection?.close();
});

test("MCPIPCConnection: get-current-time tool call returns iso, unix, and timezone fields", async () => {
    const result = await mcpClient.callTool("get-current-time", {});

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    assert.ok("iso" in output, "output should contain 'iso'");
    assert.ok("unix" in output, "output should contain 'unix'");
    assert.ok("timezone" in output, "output should contain 'timezone'");
});