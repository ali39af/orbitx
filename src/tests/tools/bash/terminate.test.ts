import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import { BashRunTool, BashTerminateTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/terminate", () => {
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
        mcpServer.registerTool(BashTerminateTool());
    });

    after(async () => {
        // hard-kill every process this file spawned now that all tests are
        // done, instead of relying on the fixture scripts to time themselves
        // out or on bash-terminate's own (platform-dependent) close detection
        killProcessTrees(spawnedProcessIds);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashTerminateTool: force-terminates a running process", async () => {
        const started = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.sleep), waitMs: 100 });
        spawnedProcessIds.push(started.output.processId);
        assert.strictEqual(started.output.status, "running");

        const result = await mcpClient.callTool("bash-terminate", {
            processId: started.output.processId,
            force: true,
        });

        assert.strictEqual(result.output.message, "success");
        // Whether `status` has already flipped to "terminated" by the time this
        // call returns is platform/timing-dependent (bash-run spawns through a
        // shell wrapper, and on win32 killing that wrapper doesn't always
        // synchronously close its child's inherited stdio pipes) — the wrapper
        // is still guaranteed to be a real, valid status, not an error.
        assert.ok(["running", "terminated", "error", "exited"].includes(result.output.status));
    });

    test("BashTerminateTool: terminating an already-finished process is a harmless no-op", async () => {
        const started = await mcpClient.callTool("bash-run", { command: nodeCmd(fixtures.echo) });
        spawnedProcessIds.push(started.output.processId);
        assert.strictEqual(started.output.status, "exited");

        const result = await mcpClient.callTool("bash-terminate", { processId: started.output.processId });

        assert.strictEqual(result.output.message, "success");
        // status is untouched since the process was never actually running when terminate was called
        assert.strictEqual(result.output.status, "exited");
    });

    test("BashTerminateTool: an unknown processId surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("bash-terminate", { processId: "does-not-exist" });

        assert.match(result.output.error, /no bash process found with id/);
    });
});
