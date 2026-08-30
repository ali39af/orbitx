import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import { BashRunTool, BashWriteInputTool, BashWaitTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/write-input", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let fixtures: BashFixtures;
    let spawnedProcessIds: string[];

    before(async () => {
        fixtures = createBashFixtures();
        spawnedProcessIds = [];

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(BashRunTool());
        mcpServer.registerTool(BashWriteInputTool());
        mcpServer.registerTool(BashWaitTool());
    });

    after(async () => {
        // in case an assertion above threw before stdin was ever written to,
        // leaving this process still waiting on stdin forever
        killProcessTrees(spawnedProcessIds);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashWriteInputTool: sends text to a running process's stdin", async () => {
        const started = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.stdinEcho), waitMs: 200 });
        spawnedProcessIds.push(started.output.processId);
        assert.strictEqual(started.output.status, "running");

        const writeResult = await mcpClient.callTool("bash-write-input", {
            processId: started.output.processId,
            text: "hello there",
        });
        assert.strictEqual(writeResult.output.message, "success");

        const waited = await mcpClient.callTool("bash-wait", { processId: started.output.processId, waitMs: 2000 });
        assert.strictEqual(waited.output.status, "exited");
        assert.match(waited.output.logs, /got:hello there/);
    });

    test("BashWriteInputTool: writing to an already-finished process is rejected", async () => {
        const started = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.echo) });
        spawnedProcessIds.push(started.output.processId);
        assert.strictEqual(started.output.status, "exited");

        const result = await mcpClient.callTool("bash-write-input", {
            processId: started.output.processId,
            text: "too late",
        });

        assert.match(result.output.error, /is not running/);
    });

    test("BashWriteInputTool: an unknown processId surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("bash-write-input", { processId: "does-not-exist", text: "x" });

        assert.match(result.output.error, /no bash process found with id/);
    });

    test("BashWriteInputTool: a non-string text value is rejected before touching any process", async () => {
        const result = await mcpClient.callTool("bash-write-input", {
            processId: "irrelevant-since-validated-first",
            text: 123 as any,
        });

        assert.match(result.output.error, /text must be a string/);
    });
});
