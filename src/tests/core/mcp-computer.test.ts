import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MCPClient, MCPComputer, MCPFSStorage, MCPRNG } from "../../index.js";
import path from "node:path";

const CONTAINER_PATH = "./data/tmp_container";

let computer: MCPComputer;
let mcpClient: MCPClient;

before(async () => {
    computer = new MCPComputer(CONTAINER_PATH, []);
    await computer.start();
    const storageHost = path.join(CONTAINER_PATH, "mcp-client-storage");
    const mcpStorage = new MCPFSStorage(storageHost);
    const mcpRNG = new MCPRNG(mcpStorage);
    mcpClient = new MCPClient("1234", computer.getConnection(), mcpStorage, mcpRNG);
});

after(async () => {
    await computer.stop();
});

test("MCPComputer: get-current-time tool call over mcp-computer returns iso, unix, and timezone fields", async () => {
    const result = await mcpClient.callTool("get-current-time", {});

    assert.ok(result, "callTool should return a result");
    assert.ok(result.output, "result should have an output field");

    const { output } = result;

    assert.ok("iso" in output, "output should contain 'iso'");
    assert.ok("unix" in output, "output should contain 'unix'");
    assert.ok("timezone" in output, "output should contain 'timezone'");
});