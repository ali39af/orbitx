import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsEditFileTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/edit-file", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;
    let filePath: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-edit-"));
        filePath = join(tmpDir, "file.txt");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsEditFileTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        writeFileSync(filePath, "line1\nline2\nline3");
    });

    test("FsEditFileTool: replaces a line range with new content", async () => {
        const result = await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 2,
            limitLine: 1,
            content: "replaced",
        });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.removedLines, 1);
        assert.strictEqual(result.output.insertedLines, 1);
        assert.strictEqual(readFileSync(filePath, "utf-8"), "line1\nreplaced\nline3");
    });

    test("FsEditFileTool: limitLine 0 inserts before offsetLine without deleting anything", async () => {
        const result = await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 2,
            limitLine: 0,
            content: "inserted",
        });

        assert.strictEqual(result.output.removedLines, 0);
        assert.strictEqual(readFileSync(filePath, "utf-8"), "line1\ninserted\nline2\nline3");
    });

    test("FsEditFileTool: offsetLine totalLines+1 appends at the end of the file", async () => {
        await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 4,
            limitLine: 0,
            content: "line4",
        });

        assert.strictEqual(readFileSync(filePath, "utf-8"), "line1\nline2\nline3\nline4");
    });

    test("FsEditFileTool: empty content just deletes the range", async () => {
        await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 2,
            limitLine: 1,
            content: "",
        });

        assert.strictEqual(readFileSync(filePath, "utf-8"), "line1\nline3");
    });

    test("FsEditFileTool: offsetLine past the end of the file surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 10,
            limitLine: 0,
            content: "x",
        });

        assert.match(result.output.error, /past end of file/);
    });

    test("FsEditFileTool: invalid offsetLine/limitLine are rejected", async () => {
        const badOffset = await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 0,
            limitLine: 1,
            content: "x",
        });
        assert.match(badOffset.output.error, /offsetLine is 1-indexed/);

        const badLimit = await mcpClient.callTool("fs-edit-file", {
            path: filePath,
            offsetLine: 1,
            limitLine: -1,
            content: "x",
        });
        assert.match(badLimit.output.error, /limitLine must be a non-negative number/);
    });

    test("FsEditFileTool: a missing file surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-edit-file", {
            path: join(tmpDir, "missing.txt"),
            offsetLine: 1,
            limitLine: 0,
            content: "x",
        });

        assert.match(result.output.error, /no file found at/);
    });
});
