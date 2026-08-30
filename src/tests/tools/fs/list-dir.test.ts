import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FsListDirTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("fs/list-dir", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-fs-list-"));
        writeFileSync(join(tmpDir, "a.txt"), "a");
        writeFileSync(join(tmpDir, "b.txt"), "bb");
        mkdirSync(join(tmpDir, "sub"));
        writeFileSync(join(tmpDir, "sub", "c.txt"), "ccc");
        mkdirSync(join(tmpDir, "node_modules"));
        writeFileSync(join(tmpDir, "node_modules", "pkg.js"), "ignored");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(FsListDirTool());
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("FsListDirTool: lists top-level entries only by default", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: tmpDir });

        const names = result.output.result.map((e: any) => e.name).sort();
        assert.deepStrictEqual(names, ["a.txt", "b.txt", "node_modules", "sub"]);
        assert.strictEqual(result.output.totalResult, 4);
    });

    test("FsListDirTool: recursive:true walks subdirectories but tags default-excluded dirs and skips their contents", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: tmpDir, recursive: true });

        const entries = result.output.result;
        const names = entries.map((e: any) => e.name).sort();
        assert.ok(names.includes("c.txt"), "should recurse into 'sub' and find c.txt");
        assert.ok(!names.includes("pkg.js"), "should not recurse into node_modules by default");

        const nodeModulesEntry = entries.find((e: any) => e.name === "node_modules");
        assert.strictEqual(nodeModulesEntry.excluded, true);
    });

    test("FsListDirTool: excludeDirs overrides which directories are skipped during recursion", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: tmpDir, recursive: true, excludeDirs: ["sub"] });

        const names = result.output.result.map((e: any) => e.name);
        assert.ok(!names.includes("c.txt"), "sub's contents should be skipped when excluded explicitly");
        assert.ok(names.includes("pkg.js"), "node_modules should be walked since it's no longer excluded");
    });

    test("FsListDirTool: pages through entries using offsetResult/limitResult", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: tmpDir, offsetResult: 1, limitResult: 2 });

        assert.strictEqual(result.output.result.length, 2);
        assert.strictEqual(result.output.offsetResult, 1);
        assert.strictEqual(result.output.totalResult, 4);
    });

    test("FsListDirTool: a missing directory surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: join(tmpDir, "missing") });

        assert.match(result.output.error, /no directory found at/);
    });

    test("FsListDirTool: listing a file path surfaces a descriptive error", async () => {
        const result = await mcpClient.callTool("fs-list-dir", { path: join(tmpDir, "a.txt") });

        assert.match(result.output.error, /is a file, not a directory/);
    });
});
