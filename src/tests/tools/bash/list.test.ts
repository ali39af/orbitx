import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "fs";
import { BashRunTool, BashListTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/list", () => {
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
        mcpServer.registerTool(BashListTool());
    });

    after(async () => {
        killProcessTrees(spawnedProcessIds);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashListTool: lists a launched process with its status and command", async () => {
        const command = nodeCmd(fixtures.echo);
        const started = await mcpClient.callTool("bash-run", { command });
        spawnedProcessIds.push(started.output.processId);

        const result = await mcpClient.callTool("bash-list", {});

        // The process table is a module-wide singleton shared across every bash
        // test file in this run, so look up the specific entry rather than
        // asserting on the list's total length.
        const entry = result.output.processes.find((p: any) => p.processId === started.output.processId);
        assert.ok(entry, "the just-started process should appear in bash-list");
        assert.strictEqual(entry.command, command);
        assert.strictEqual(entry.status, "exited");
        assert.strictEqual(entry.exitCode, 0);
        assert.strictEqual(typeof entry.startedAt, "number");
    });
});
