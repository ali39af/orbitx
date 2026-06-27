import { describe, test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import MCPIPCConnection from "../core/mcp-ipc-connection";
import MCPServer from "../core/mcp-server";
import MCPClient from "../core/mcp-client";
import { GetCurrentTimeTool } from "../tools/utils";
import { FetchTool, WebSearchTool } from "../tools/www";

describe("MCP Client and Server", async () => {
    const path1 = os.platform() == "win32" ? `\\\\.\\pipe\\test${Math.random() * 1000}` : `/tmp/mcp_test${Math.random() * 1000}.sock`;
    const path2 = os.platform() == "win32" ? `\\\\.\\pipe\\test${Math.random() * 1000}` : `/tmp/mcp_test${Math.random() * 1000}.sock`;

    const ipcConnection11 = new MCPIPCConnection(path1);
    const ipcConnection21 = new MCPIPCConnection(path2);

    const ipcConnection12 = new MCPIPCConnection(path1);
    const ipcConnection22 = new MCPIPCConnection(path2);

    let mcpServer1: MCPServer;
    let mcpServer2: MCPServer;
    let mcpClient: MCPClient;

    await test("should connect MCP Client to Servers and get empty tools", async () => {
        mcpServer1 = new MCPServer(ipcConnection11);
        mcpServer2 = new MCPServer(ipcConnection21);
        mcpClient = new MCPClient("DEFAULT_ENV", [ipcConnection12, ipcConnection22]);
        const result = await mcpClient.getTools();
        assert.equal(result.length, 0);
    });

    await test("should register tool on client side", async () => {
        mcpClient.registerTool(GetCurrentTimeTool);
        const result = await mcpClient.getTools();

        assert.equal(result.length, 1);
    });

    await test("should register tool on server1 side", async () => {
        mcpServer1.registerTool(FetchTool);
        const result = await mcpClient.getTools();

        assert.equal(result.length, 2);
    });

    await test("should register tool on server2 side", async () => {
        mcpServer2.registerTool(WebSearchTool);
        const result = await mcpClient.getTools();

        assert.equal(result.length, 3);
    });

    await test("should call tool on client side", async () => {
        const result = await mcpClient.callTool(GetCurrentTimeTool.getOptions().name, {});

        assert.ok(typeof result == "string");
    });

    await test("should call tool on server1 side", async () => {
        const result = await mcpClient.callTool(FetchTool.getOptions().name, { url: "https://google.com" });

        assert.ok(typeof result == "string");
    });

    await test("should call tool on server2 side", async () => {
        const result = await mcpClient.callTool(WebSearchTool.getOptions().name, { query: "test" });

        assert.ok(typeof result == "string");
    });


    // Need Close Connections
});