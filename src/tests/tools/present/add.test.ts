import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PresentAddTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("present/add", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let sourceDir: string;
    let presentDir: string;
    let previousPresentPath: string | undefined;

    before(async () => {
        sourceDir = mkdtempSync(join(tmpdir(), "orbitx-present-add-src-"));
        presentDir = mkdtempSync(join(tmpdir(), "orbitx-present-add-dest-"));
        previousPresentPath = process.env.PRESENT_PATH;
        process.env.PRESENT_PATH = presentDir;

        writeFileSync(join(sourceDir, "report.txt"), "report content");
        mkdirSync(join(sourceDir, "adir"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(PresentAddTool());
    });

    after(async () => {
        mcpConnection?.close();
        process.env.PRESENT_PATH = previousPresentPath;
        rmSync(sourceDir, { recursive: true, force: true });
        rmSync(presentDir, { recursive: true, force: true });
    });

    test("PresentAddTool: copies the file into the present folder", async () => {
        const path = join(sourceDir, "report.txt");
        const result = await mcpClient.callTool("present-add", { path });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.path, join(presentDir, "report.txt"));
        assert.ok(existsSync(result.output.path));
        assert.strictEqual(readFileSync(result.output.path, "utf-8"), "report content");
        // source file must remain untouched (copy, not move)
        assert.ok(existsSync(path));
    });

    test("PresentAddTool: a directory path is rejected", async () => {
        const result = await mcpClient.callTool("present-add", { path: join(sourceDir, "adir") });

        assert.match(result.output.error, /presents must be files/);
    });

    test("PresentAddTool: a missing file surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("present-add", { path: join(sourceDir, "missing.txt") });

        assert.match(result.output.error, /no file found at/);
    });
});
