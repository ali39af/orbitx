import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DelayTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

let mcpConnection: MCPConnection | undefined;
let mcpClient: MCPClient;
let mcpServer: MCPServer;

before(async () => {
    mcpConnection = new MCPConnection();
    mcpClient = new MCPClient("1234", mcpConnection);
    mcpServer = new MCPServer(mcpConnection);
    mcpServer.registerTool(DelayTool());
});

after(async () => {
    mcpConnection?.close();
});

test("DelayTool: delay tool call returns waited field matching requested ms", async () => {
    const requestedMs = 50;

    const start = Date.now();
    const result = await mcpClient.callTool("delay", { ms: requestedMs });
    const elapsed = Date.now() - start;

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    assert.ok("waited" in output, "output should contain 'waited'");
    assert.strictEqual(output.waited, requestedMs, "waited should equal the requested ms");
    assert.ok(
        elapsed >= requestedMs,
        `actual elapsed time (${elapsed}ms) should be at least the requested delay (${requestedMs}ms)`
    );
});
