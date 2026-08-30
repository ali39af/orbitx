import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsCreateDirTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/create-dir", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-create-dir-"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsCreateDirTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsCreateDirTool: creates a directory including missing parents", async () => {
        const path = join(tmpDir, "a", "b", "c");
        const result = await mcpClient.callTool("fs-create-dir", { path });

        assert.strictEqual(result.output.message, "success");
        assert.ok(existsSync(path));
        assert.ok(statSync(path).isDirectory());
    });

    test("FsCreateDirTool: creating an already-existing directory is a no-op success", async () => {
        const path = join(tmpDir, "already-there");
        await mcpClient.callTool("fs-create-dir", { path });

        const result = await mcpClient.callTool("fs-create-dir", { path });
        assert.strictEqual(result.output.message, "success");
    });
});
