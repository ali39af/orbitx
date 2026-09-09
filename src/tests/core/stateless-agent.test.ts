import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { StatelessAgent, GetCurrentTimeTool } from "../../index.js";
import { ScriptedProvider } from "./scripted-provider.js";

describe("core/stateless-agent", () => {
    test("run(): a plain reply with no tool call is one chat() call", async () => {
        const provider = new ScriptedProvider("p", () => ({ content: "42" }));
        const agent = new StatelessAgent({ instruction: "answer with a number", aiProvider: provider });

        const result = await agent.run("what is 6*7?");

        assert.strictEqual(result.content, "42");
        assert.deepStrictEqual(result.toolCalls, []);
        assert.strictEqual(result.usage.length, 1);
        assert.strictEqual(provider.getCallCount(), 1);
    });

    test("run(): a tool call is dispatched inline, still just one chat() call — no automatic follow-up", async () => {
        const tool = GetCurrentTimeTool();
        const mcpClient = {
            getTools: async () => [{ name: tool.getOptions().name, description: tool.getOptions().description, inputs: tool.getOptions().inputs }],
            callTool: async () => ({ output: { now: "2026-09-08T00:00:00Z" } }),
        } as any;

        const provider = new ScriptedProvider("p", () => ({ toolCalls: [{ name: tool.getOptions().name, inputs: {} }] }));

        const agent = new StatelessAgent({
            instruction: "answer with the current time",
            aiProvider: provider,
            mcpClient,
            allowedTools: [tool],
        });

        const result = await agent.run("what time is it?");

        assert.strictEqual(result.toolCalls.length, 1);
        assert.strictEqual(result.toolCalls[0]!.name, tool.getOptions().name);
        assert.deepStrictEqual(JSON.parse(result.toolCalls[0]!.resultText), { now: "2026-09-08T00:00:00Z" });
        assert.strictEqual(result.usage.length, 1);
        assert.strictEqual(provider.getCallCount(), 1);
    });

    test("run(): messages returned include the tool result, ready to hand back in for a follow-up run()", async () => {
        const tool = GetCurrentTimeTool();
        const mcpClient = {
            getTools: async () => [{ name: tool.getOptions().name, description: tool.getOptions().description, inputs: tool.getOptions().inputs }],
            callTool: async () => ({ output: { now: "2026-09-08T00:00:00Z" } }),
        } as any;

        const provider = new ScriptedProvider("p", [
            () => ({ toolCalls: [{ name: tool.getOptions().name, inputs: {} }] }),
            () => ({ content: "it is 2026-09-08" }),
        ]);

        const agent = new StatelessAgent({ instruction: "x", aiProvider: provider, mcpClient, allowedTools: [tool] });

        const first = await agent.run("what time is it?");
        assert.strictEqual(first.messages.at(-1)?.role, "tool");

        const second = await agent.run("now answer in plain text", undefined, first.messages);
        assert.strictEqual(second.content, "it is 2026-09-08");
        assert.strictEqual(provider.getCallCount(), 2);
        // second call's messages = first's full history + the new user turn + its own assistant turn
        assert.strictEqual(second.messages.length, first.messages.length + 2);
    });

    test("run(): a tool the model calls that isn't allowed comes back as an error result, not a throw", async () => {
        const mcpClient = { getTools: async () => [], callTool: async () => ({ output: {} }) } as any;

        const provider = new ScriptedProvider("p", () => ({ toolCalls: [{ name: "not-allowed", inputs: {} }] }));

        const agent = new StatelessAgent({ instruction: "x", aiProvider: provider, mcpClient, allowedTools: [] });
        const result = await agent.run("go");

        assert.match(result.toolCalls[0]!.resultText, /not found or not allowed/);
    });

    test("constructor: allowedTools without mcpClient is rejected", () => {
        const provider = new ScriptedProvider("p", () => ({ content: "x" }));
        assert.throws(
            () => new StatelessAgent({ instruction: "x", aiProvider: provider, allowedTools: [GetCurrentTimeTool()] }),
            /mcpClient is required/
        );
    });

    test("run(): two fresh calls on the same instance are independent — no shared history", async () => {
        const provider = new ScriptedProvider("p", ({ messages }) => ({ content: String(messages.length) }));
        const agent = new StatelessAgent({ instruction: "x", aiProvider: provider });

        const first = await agent.run("first");
        const second = await agent.run("second");

        assert.strictEqual(first.content, second.content);
    });
});
