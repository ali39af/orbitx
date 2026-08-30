import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsWriteFileTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/write-file", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-write-"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsWriteFileTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsWriteFileTool: creates a new file with the given content and reports bytesWritten", async () => {
        const path = join(tmpDir, "new.txt");
        const result = await mcpClient.callTool("fs-write-file", { path, content: "hello world" });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.bytesWritten, Buffer.byteLength("hello world", "utf-8"));
        assert.strictEqual(readFileSync(path, "utf-8"), "hello world");
    });

    test("FsWriteFileTool: creates missing parent directories by default", async () => {
        const path = join(tmpDir, "nested", "deep", "file.txt");
        await mcpClient.callTool("fs-write-file", { path, content: "nested" });

        assert.strictEqual(readFileSync(path, "utf-8"), "nested");
    });

    test("FsWriteFileTool: createDirs:false fails when the parent directory doesn't exist", async () => {
        const path = join(tmpDir, "missing-parent", "file.txt");
        const result = await mcpClient.callTool("fs-write-file", { path, content: "x", createDirs: false });

        assert.ok(result.output.error, "should return an error since the parent dir was never created");
        assert.strictEqual(existsSync(path), false);
    });

    test("FsWriteFileTool: overwrites an existing file's content", async () => {
        const path = join(tmpDir, "overwrite.txt");
        await mcpClient.callTool("fs-write-file", { path, content: "first" });
        await mcpClient.callTool("fs-write-file", { path, content: "second" });

        assert.strictEqual(readFileSync(path, "utf-8"), "second");
    });

    test("FsWriteFileTool: non-string content is rejected", async () => {
        const path = join(tmpDir, "bad.txt");
        const result = await mcpClient.callTool("fs-write-file", { path, content: 123 as any });

        assert.match(result.output.error, /content must be a string/);
    });
});
