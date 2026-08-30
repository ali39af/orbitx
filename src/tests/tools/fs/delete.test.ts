import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsDeleteTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/delete", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-delete-"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsDeleteTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsDeleteTool: deletes a file", async () => {
        const path = join(tmpDir, "file.txt");
        writeFileSync(path, "x");

        const result = await mcpClient.callTool("fs-delete", { path });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.type, "file");
        assert.strictEqual(existsSync(path), false);
    });

    test("FsDeleteTool: a directory without recursive:true fails even when it's empty", async () => {
        // Node's fs.rm requires recursive:true for ANY directory target, not
        // just non-empty ones — it always throws ERR_FS_EISDIR otherwise.
        const path = join(tmpDir, "empty-dir");
        mkdirSync(path);

        const result = await mcpClient.callTool("fs-delete", { path });

        assert.ok(result.output.error, "should fail without recursive:true even on an empty directory");
        assert.ok(existsSync(path), "directory should still exist");
    });

    test("FsDeleteTool: recursive:true deletes an empty directory", async () => {
        const path = join(tmpDir, "empty-dir-recursive");
        mkdirSync(path);

        const result = await mcpClient.callTool("fs-delete", { path, recursive: true });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(result.output.type, "directory");
        assert.strictEqual(existsSync(path), false);
    });

    test("FsDeleteTool: a non-empty directory without recursive:true fails", async () => {
        const path = join(tmpDir, "non-empty-dir");
        mkdirSync(path);
        writeFileSync(join(path, "inner.txt"), "x");

        const result = await mcpClient.callTool("fs-delete", { path });

        assert.ok(result.output.error, "should fail without recursive:true on a non-empty directory");
        assert.ok(existsSync(path), "directory should still exist");
    });

    test("FsDeleteTool: recursive:true deletes a directory and everything inside it", async () => {
        const path = join(tmpDir, "recursive-dir");
        mkdirSync(path);
        writeFileSync(join(path, "inner.txt"), "x");

        const result = await mcpClient.callTool("fs-delete", { path, recursive: true });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(existsSync(path), false);
    });

    test("FsDeleteTool: a missing path surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-delete", { path: join(tmpDir, "nope") });

        assert.match(result.output.error, /no file or directory found at/);
    });
});
