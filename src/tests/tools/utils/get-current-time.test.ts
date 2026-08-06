import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GetCurrentTimeTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

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

test("GetCurrentTimeTool: iso field is a valid ISO 8601 timestamp close to now", async () => {
    const before = Date.now();
    const result = await mcpClient.callTool("get-current-time", {});
    const after = Date.now();

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    // iso should parse to a valid date
    const parsed = new Date(output.iso as string);
    assert.ok(!Number.isNaN(parsed.getTime()), "iso field should be a valid date string");

    // iso should correspond to roughly "now" (within the call window)
    const parsedMs = parsed.getTime();
    assert.ok(
        parsedMs >= before && parsedMs <= after,
        `iso timestamp (${parsedMs}) should fall between ${before} and ${after}`
    );
});

test("GetCurrentTimeTool: unix field matches iso field and timezone is a non-empty string", async () => {
    const result = await mcpClient.callTool("get-current-time", {});

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    // unix should be a number
    assert.strictEqual(typeof output.unix, "number", "unix field should be a number");

    // unix (assumed seconds) should match iso when converted
    const isoMs = new Date(output.iso as string).getTime();
    const unixMs = (output.unix as number) * 1000;
    assert.ok(
        Math.abs(isoMs - unixMs) < 1000,
        `unix field (${output.unix}) should correspond to iso field (${output.iso})`
    );

    // timezone should be a non-empty string
    assert.strictEqual(typeof output.timezone, "string", "timezone field should be a string");
    assert.ok((output.timezone as string).length > 0, "timezone field should not be empty");
});