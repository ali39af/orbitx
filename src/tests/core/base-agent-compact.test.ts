import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BaseAgent, MCPClient, MCPConnection, MCPServer, MCPTool } from "../../index.js";
import type { Message, ToolSchema } from "../../index.js";
import { ScriptedProvider } from "./scripted-provider.js";

function agentWith(provider: ScriptedProvider, compactInstructions = "") {
    const connection = new MCPConnection();
    new MCPServer(connection);
    const mcpClient = new MCPClient("compact-test", connection);
    return new BaseAgent({ instruction: "test", allowedTools: [], aiProvider: provider, mcpClient, compactInstructions });
}

const systemPrompt = (messages: Message[]) => messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");

describe("core/base-agent compaction", () => {
    test("keeps the language, the files to read again and the user's latest message", async () => {
        const seen: Message[][] = [];
        const provider = new ScriptedProvider("compact", [
            ({ messages }) => {
                seen.push(messages);
                return {
                    toolCalls: [{
                        name: "compact_memory",
                        inputs: {
                            new_memory: "Building a landing page; hero done, footer next.",
                            language: "Persian",
                            files_to_reread: [{ path: "src/App.tsx", reason: "the page being edited" }, "PLAN.md"],
                            continue_iterating: true,
                        },
                    }],
                };
            },
            ({ messages }) => {
                seen.push(messages);
                return { content: "ادامه می‌دهم." };
            },
        ]);
        const agent = agentWith(provider, "Keep the todo list's state.");

        await agent.run("یک صفحه فرود بساز");

        const after = seen[1]!;
        const carried = after.filter((message) => message.role !== "system");
        assert.equal(carried[0]!.role, "user");
        assert.equal(carried[0]!.hidden, true);
        assert.match(carried[0]!.content!, /یک صفحه فرود بساز/);
        assert.match(carried[0]!.content!, /src\/App\.tsx, PLAN\.md/);
        assert.match(carried[0]!.content!, /Reply to the user in Persian/);

        const prompt = systemPrompt(after);
        assert.match(prompt, /Building a landing page/);
        assert.match(prompt, /Conversation language: Persian/);
        assert.match(prompt, /- src\/App\.tsx — the page being edited/);
        assert.match(prompt, /Keep the todo list's state\./);

        const state = agent.getCurrentAgentStates();
        assert.match(state.compactMemory, /Files to read again/);
        assert.equal(state.messagesCompact.length, 2);
    });

    test("a note with only new_memory still works and carries the user's message", async () => {
        const seen: Message[][] = [];
        const provider = new ScriptedProvider("plain", [
            () => ({ toolCalls: [{ name: "compact_memory", inputs: { new_memory: "note" } }] }),
            ({ messages }) => {
                seen.push(messages);
                return { content: "ok" };
            },
        ]);
        const agent = agentWith(provider);

        await agent.run("hello there");

        const first = seen[0]!.find((message) => message.role === "user")!;
        assert.match(first.content!, /^Memory compacted\./);
        assert.match(first.content!, /hello there/);
        assert.doesNotMatch(first.content!, /Reply to the user in/);
        assert.equal(agent.getCurrentAgentStates().compactMemory, "note");
    });

    test("a remote tool that publishes no inputs takes the agent's own schema", async () => {
        const connection = new MCPConnection();
        const server = new MCPServer(connection);
        const execute = async () => ({ ok: true });
        server.registerTool(new MCPTool({ name: "proxy-tool", description: "forwards", inputs: [], execute }));
        server.registerTool(new MCPTool({ name: "own-tool", description: "remote", inputs: [{ name: "a", type: "string", description: "remote a" }], execute }));
        const allowed = [
            new MCPTool({ name: "proxy-tool", description: "Opens a page.", inputs: [{ name: "url", type: "string", description: "the address", required: true }], execute }),
            new MCPTool({ name: "own-tool", description: "local", inputs: [{ name: "b", type: "string", description: "local b" }], execute }),
        ];
        let sent: ToolSchema[] = [];
        const provider = new ScriptedProvider("schemas", [() => ({ content: "done" })]);
        const chat = provider.chat.bind(provider);
        provider.chat = (messages, stream, tools, signal) => {
            sent = tools ?? [];
            return chat(messages, stream, tools, signal);
        };
        const agent = new BaseAgent({ instruction: "test", allowedTools: allowed, aiProvider: provider, mcpClient: new MCPClient("schema-test", connection) });

        await agent.run("go");

        const proxy = sent.find((tool) => tool.name === "proxy-tool")!;
        assert.equal(proxy.description, "Opens a page.");
        assert.deepEqual(proxy.inputs.map((input) => input.name), ["url"]);
        assert.deepEqual(sent.find((tool) => tool.name === "own-tool")!.inputs.map((input) => input.name), ["a"]);
    });
});
