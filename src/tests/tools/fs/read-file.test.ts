import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsReadFileTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/read-file", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-read-"));
        writeFileSync(join(tmpDir, "file.txt"), "line1\nline2\nline3\nline4\nline5");
        mkdirSync(join(tmpDir, "adir"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsReadFileTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsReadFileTool: reads a whole file by default", async () => {
        const result = await mcpClient.callTool("fs-read-file", { path: join(tmpDir, "file.txt") });

        assert.strictEqual(result.output.content, "line1\nline2\nline3\nline4\nline5");
        assert.strictEqual(result.output.totalLines, 5);
        assert.strictEqual(result.output.startLine, 1);
        assert.strictEqual(result.output.endLine, 5);
    });

    test("FsReadFileTool: pages through a file using offsetLine/limitLine", async () => {
        const result = await mcpClient.callTool("fs-read-file", {
            path: join(tmpDir, "file.txt"),
            offsetLine: 2,
            limitLine: 2,
        });

        assert.strictEqual(result.output.content, "line2\nline3");
        assert.strictEqual(result.output.startLine, 2);
        assert.strictEqual(result.output.endLine, 3);
        assert.strictEqual(result.output.totalLines, 5);
    });

    test("FsReadFileTool: a missing file surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-read-file", { path: join(tmpDir, "missing.txt") });

        assert.match(result.output.error, /no file found at/);
    });

    test("FsReadFileTool: reading a directory surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-read-file", { path: join(tmpDir, "adir") });

        assert.match(result.output.error, /is a directory, not a file/);
    });
});
