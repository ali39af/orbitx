import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsStatTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/stat", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-stat-"));
        writeFileSync(join(tmpDir, "file.txt"), "hello");
        mkdirSync(join(tmpDir, "adir"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsStatTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsStatTool: reports type/size/timestamps for an existing file", async () => {
        const result = await mcpClient.callTool("fs-stat", { path: join(tmpDir, "file.txt") });

        assert.strictEqual(result.output.exists, true);
        assert.strictEqual(result.output.type, "file");
        assert.strictEqual(result.output.size, Buffer.byteLength("hello"));
        assert.ok(!Number.isNaN(new Date(result.output.modifiedAt).getTime()));
        assert.ok(!Number.isNaN(new Date(result.output.createdAt).getTime()));
    });

    test("FsStatTool: reports type 'directory' for a directory", async () => {
        const result = await mcpClient.callTool("fs-stat", { path: join(tmpDir, "adir") });

        assert.strictEqual(result.output.exists, true);
        assert.strictEqual(result.output.type, "directory");
    });

    test("FsStatTool: a missing path returns exists:false instead of throwing", async () => {
        const result = await mcpClient.callTool("fs-stat", { path: join(tmpDir, "missing") });

        assert.deepStrictEqual(result.output, { exists: false });
    });
});
