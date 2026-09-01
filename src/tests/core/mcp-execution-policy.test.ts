import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
    MCPClient,
    MCPConnection,
    MCPServer,
    MCPTool,
    MCPExecutionPolicy,
    MCPBypassExecutionPolicy,
    type MCPToolCallRequest,
} from "../../index.js";

const EchoTool = () => new MCPTool({
    name: "echo",
    description: "echoes its input back",
    inputs: [{ name: "value", type: "string", description: "value to echo" }],
    execute: async (_envID: string, inputs: Record<string, any>) => ({ value: inputs.value }),
});

class AllowlistPolicy extends MCPExecutionPolicy {
    #allowed: Set<string>;
    calls: MCPToolCallRequest[] = [];

    constructor(allowed: string[]) {
        super();
        this.#allowed = new Set(allowed);
    }

    authorize(request: MCPToolCallRequest): boolean {
        this.calls.push(request);
        return this.#allowed.has(request.toolName);
    }
}

class AsyncDenyPolicy extends MCPExecutionPolicy {
    async authorize(): Promise<boolean> {
        return false;
    }
}

describe("core/mcp-execution-policy", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(EchoTool());
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("MCPExecutionPolicy: defaults to MCPBypassExecutionPolicy, allowing every call", async () => {
        const client = new MCPClient("policy-default", mcpConnection!);

        const result = await client.callTool("echo", { value: "hi" });

        assert.equal(result.output.value, "hi");
    });

    test("MCPExecutionPolicy: MCPBypassExecutionPolicy.authorize() always returns true", () => {
        const policy = new MCPBypassExecutionPolicy();
        assert.equal(policy.authorize(), true);
    });

    test("MCPExecutionPolicy: a denying policy rejects the call before it reaches the tool", async () => {
        const client = new MCPClient("policy-deny", mcpConnection!, undefined, undefined, undefined, new AsyncDenyPolicy());

        await assert.rejects(
            () => client.callTool("echo", { value: "hi" }),
            /MCPExecutionPolicy denied tool call "echo"/,
        );
    });

    test("MCPExecutionPolicy: an allowlist policy only allows listed tool names", async () => {
        const policy = new AllowlistPolicy(["echo"]);
        const client = new MCPClient("policy-allowlist", mcpConnection!, undefined, undefined, undefined, policy);

        const result = await client.callTool("echo", { value: "ok" });
        assert.equal(result.output.value, "ok");

        await assert.rejects(() => client.callTool("not-a-real-tool", {}));
    });

    test("MCPExecutionPolicy: authorize() receives toolName, inputs, envID, and toolCallId", async () => {
        const policy = new AllowlistPolicy(["echo"]);
        const client = new MCPClient("policy-request-shape", mcpConnection!, undefined, undefined, undefined, policy);

        await client.callTool("echo", { value: "hi" }, "call-123");

        assert.equal(policy.calls.length, 1);
        assert.deepEqual(policy.calls[0], {
            toolName: "echo",
            inputs: { value: "hi" },
            envID: "policy-request-shape",
            toolCallId: "call-123",
        });
    });

    test("MCPExecutionPolicy: also gates a locally client-registered tool", async () => {
        const policy = new AllowlistPolicy([]);
        const client = new MCPClient("policy-local-tool", mcpConnection!, undefined, undefined, undefined, policy);
        client.registerTool(EchoTool());

        await assert.rejects(
            () => client.callTool("echo", { value: "hi" }),
            /MCPExecutionPolicy denied tool call "echo"/,
        );
    });
});
