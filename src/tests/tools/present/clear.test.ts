import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PresentAddTool, PresentClearTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("present/clear", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let sourceDir: string;
    let presentDir: string;
    let previousPresentPath: string | undefined;

    before(async () => {
        sourceDir = mkdtempSync(join(tmpdir(), "orbitx-present-clear-src-"));
        presentDir = mkdtempSync(join(tmpdir(), "orbitx-present-clear-dest-"));
        previousPresentPath = process.env.PRESENT_PATH;
        process.env.PRESENT_PATH = presentDir;

        writeFileSync(join(sourceDir, "a.txt"), "aaa");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(PresentAddTool());
        mcpServer.registerTool(PresentClearTool());
    });

    after(async () => {
        mcpConnection?.close();
        process.env.PRESENT_PATH = previousPresentPath;
        rmSync(sourceDir, { recursive: true, force: true });
        rmSync(presentDir, { recursive: true, force: true });
    });

    test("PresentClearTool: removes every file from the present folder and reports how many were removed", async () => {
        await mcpClient.callTool("present-add", { path: join(sourceDir, "a.txt") });

        const result = await mcpClient.callTool("present-clear", {});

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.removed, 1);
        assert.deepStrictEqual(readdirSync(presentDir), []);
    });

    test("PresentClearTool: clearing an already-empty present folder reports 0 removed", async () => {
        const result = await mcpClient.callTool("present-clear", {});

        assert.strictEqual(result.output.removed, 0);
    });
});
