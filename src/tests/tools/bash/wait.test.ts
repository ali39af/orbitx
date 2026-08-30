import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import { BashRunTool, BashWaitTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/wait", () => {
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
        mcpServer.registerTool(BashWaitTool());
    });

    after(async () => {
        killProcessTrees(spawnedProcessIds);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashWaitTool: waits for a still-running process to finish and returns its final output", async () => {
        const started = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.delayedEcho), waitMs: 0 });
        spawnedProcessIds.push(started.output.processId);
        assert.strictEqual(started.output.status, "running");

        const waited = await mcpClient.callTool("bash-wait", { processId: started.output.processId, waitMs: 3000 });

        assert.strictEqual(waited.output.status, "exited");
        assert.strictEqual(waited.output.exitCode, 0);
        assert.match(waited.output.logs, /done/);
    });

    test("BashWaitTool: an unknown processId surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("bash-wait", { processId: "does-not-exist" });

        assert.match(result.output.error, /no bash process found with id/);
    });

    test("BashWaitTool: an empty processId is rejected", async () => {
        const result = await mcpClient.callTool("bash-wait", { processId: "" });

        assert.match(result.output.error, /processId must be a non-empty string/);
    });
});
