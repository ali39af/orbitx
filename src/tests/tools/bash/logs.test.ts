import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { BashRunTool, BashLogsTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";
import { createBashFixtures, nodeCmd, type BashFixtures } from "./fixtures.js";
import { killProcessTrees } from "./kill-tree.js";

describe("bash/logs", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let fixtures: BashFixtures;
    let processId: string;

    before(async () => {
        fixtures = createBashFixtures();
        const multiline = join(fixtures.dir, "multiline.js");
        // a single console.log call -> a single stdout write -> deterministic chunking
        writeFileSync(multiline, "console.log('line1\\nline2\\nline3');");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(BashRunTool());
        mcpServer.registerTool(BashLogsTool());

        const result = await mcpClient.callTool("bash-run", { command: nodeCmd(multiline) });
        processId = result.output.processId;
    });

    after(async () => {
        killProcessTrees([processId]);
        mcpConnection?.close();
        rmSync(fixtures.dir, { recursive: true, force: true });
    });

    test("BashLogsTool: returns the full combined log by default", async () => {
        const result = await mcpClient.callTool("bash-logs", { processId });

        assert.strictEqual(result.output.status, "exited");
        assert.match(result.output.content, /line1[\s\S]*line2[\s\S]*line3/);
        // 3 printed lines plus the trailing empty line from console.log's newline
        assert.strictEqual(result.output.totalLines, 4);
    });

    test("BashLogsTool: pages through the log using offsetLine/limitLine", async () => {
        const result = await mcpClient.callTool("bash-logs", { processId, offsetLine: 1, limitLine: 2 });

        assert.strictEqual(result.output.content, "line2\nline3");
    });

    test("BashLogsTool: an unknown processId surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("bash-logs", { processId: "does-not-exist" });

        assert.match(result.output.error, /no bash process found with id/);
    });
});
