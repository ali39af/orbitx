import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { MCPClient, MCPConnection, MCPServer, MCPOutputFilter, MCPFilter, MCPTool } from "../../index.js";

const SecretTool = () => new MCPTool({
    name: "get-secret",
    description: "returns a value containing a secret token",
    inputs: [],
    execute: async () => ({ message: "your api key is sk-1234567890abcdef" }),
});

describe("core/mcp-output-filter", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(SecretTool());
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("MCPOutputFilter: redacts a literal string match in tool output", async () => {
        const filter = new MCPOutputFilter(["sk-1234567890abcdef"]);
        const client = new MCPClient("filter-literal", mcpConnection!, undefined, undefined, filter);

        const result = await client.callTool("get-secret", {});

        assert.ok(!JSON.stringify(result.output).includes("sk-1234567890abcdef"), "secret should not appear in output");
        assert.equal(result.output.message, "your api key is FILTERED_OUTPUT");
    });

    test("MCPOutputFilter: redacts a regex match in tool output", async () => {
        const filter = new MCPOutputFilter([/sk-[a-zA-Z0-9]{10,}/]);
        const client = new MCPClient("filter-regex", mcpConnection!, undefined, undefined, filter);

        const result = await client.callTool("get-secret", {});

        assert.equal(result.output.message, "your api key is FILTERED_OUTPUT");
    });

    test("MCPOutputFilter: no values configured leaves output untouched", async () => {
        const client = new MCPClient("filter-none", mcpConnection!, undefined, undefined, new MCPOutputFilter([]));

        const result = await client.callTool("get-secret", {});

        assert.equal(result.output.message, "your api key is sk-1234567890abcdef");
    });

    test("MCPOutputFilter: MCPFilter is a deprecated alias for the same class", () => {
        assert.equal(MCPFilter, MCPOutputFilter);
    });
});
