import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsMoveTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/move", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-move-"));

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsMoveTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsMoveTool: renames/moves a file", async () => {
        const from = join(tmpDir, "source.txt");
        const to = join(tmpDir, "dest.txt");
        writeFileSync(from, "content");

        const result = await mcpClient.callTool("fs-move", { from, to });

        assert.strictEqual(result.output.message, "success");
        assert.strictEqual(existsSync(from), false);
        assert.strictEqual(readFileSync(to, "utf-8"), "content");
    });

    test("FsMoveTool: creates missing parent directories of the destination", async () => {
        const from = join(tmpDir, "source2.txt");
        const to = join(tmpDir, "nested", "deep", "dest2.txt");
        writeFileSync(from, "content2");

        await mcpClient.callTool("fs-move", { from, to });

        assert.strictEqual(readFileSync(to, "utf-8"), "content2");
    });

    test("FsMoveTool: a missing source surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-move", {
            from: join(tmpDir, "missing.txt"),
            to: join(tmpDir, "dest3.txt"),
        });

        assert.match(result.output.error, /no file or directory found at/);
    });
});
