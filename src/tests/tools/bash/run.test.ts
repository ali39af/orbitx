import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import { BashRunTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/run", () => {
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
    });

    after(async () => {
        // hard-kill every process this file spawned now that all tests are
        // done, instead of relying on the fixture scripts to time themselves out
        killProcessTrees(spawnedProcessIds);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashRunTool: runs a quick command to completion and returns its output", async () => {
        const result = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.echo) });
        spawnedProcessIds.push(result.output.processId);

        assert.strictEqual(result.output.status, "exited");
        assert.strictEqual(result.output.exitCode, 0);
        assert.match(result.output.logs, /hello from stdout/);
        assert.strictEqual(typeof result.output.processId, "string");
    });

    test("BashRunTool: a non-zero exit code is reported as status 'error'", async () => {
        const result = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.fail) });
        spawnedProcessIds.push(result.output.processId);

        assert.strictEqual(result.output.status, "error");
        assert.strictEqual(result.output.exitCode, 3);
    });

    test("BashRunTool: a still-running process returns early with status 'running'", async () => {
        const result = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.sleep), waitMs: 100 });
        spawnedProcessIds.push(result.output.processId);

        assert.strictEqual(result.output.status, "running");
        assert.strictEqual(result.output.exitCode, null);
    });

    test("BashRunTool: an empty command is rejected", async () => {
        const result = await mcpClient.callTool("bash-run", { command: "" });

        assert.match(result.output.error, /command must be a non-empty string/);
    });
});
