import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PresentAddTool, PresentGetListTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("present/get-list", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let sourceDir: string;
    let presentDir: string;
    let previousPresentPath: string | undefined;

    before(async () => {
        sourceDir = mkdtempSync(join(tmpdir(), "orbitx-present-list-src-"));
        presentDir = mkdtempSync(join(tmpdir(), "orbitx-present-list-dest-"));
        previousPresentPath = process.env.PRESENT_PATH;
        process.env.PRESENT_PATH = presentDir;

        writeFileSync(join(sourceDir, "a.txt"), "aaa");
        writeFileSync(join(sourceDir, "b.txt"), "bb");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(PresentAddTool());
        mcpServer.registerTool(PresentGetListTool());
    });

    after(async () => {
        mcpConnection?.close();
        process.env.PRESENT_PATH = previousPresentPath;
        rmSync(sourceDir, { recursive: true, force: true });
        rmSync(presentDir, { recursive: true, force: true });
    });

    test("PresentGetListTool: starts empty when nothing has been presented", async () => {
        const result = await mcpClient.callTool("present-get-list", {});

        assert.deepStrictEqual(result.output.files, []);
        assert.strictEqual(result.output.total, 0);
    });

    test("PresentGetListTool: lists every presented file with its name/path/size", async () => {
        await mcpClient.callTool("present-add", { path: join(sourceDir, "a.txt") });
        await mcpClient.callTool("present-add", { path: join(sourceDir, "b.txt") });

        const result = await mcpClient.callTool("present-get-list", {});

        assert.strictEqual(result.output.total, 2);
        const names = result.output.files.map((f: any) => f.name).sort();
        assert.deepStrictEqual(names, ["a.txt", "b.txt"]);

        const a = result.output.files.find((f: any) => f.name === "a.txt");
        assert.strictEqual(a.size, 3);
        assert.strictEqual(a.path, join(presentDir, "a.txt"));
    });
});
