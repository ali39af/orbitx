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
    test("compactInstructions go into the system prompt and the compaction nudge", async () => {
        const seen: Message[][] = [];
        const provider = new ScriptedProvider("compact", [
            ({ messages }) => {
                seen.push(messages);
                return { toolCalls: [{ name: "compact_memory", inputs: { new_memory: "Landing page: hero done, footer next.", continue_iterating: true } }] };
            },
            ({ messages }) => {
                seen.push(messages);
                return { content: "ok" };
            },
        ]);
        const agent = agentWith(provider, "Name the files to read again; keep the user's language.");

        await agent.run("build a landing page");

        assert.match(systemPrompt(seen[0]!), /COMPACTION:\nName the files to read again; keep the user's language\./);
        const after = systemPrompt(seen[1]!);
        assert.match(after, /Landing page: hero done/);
        assert.match(after, /COMPACTION:/);
        assert.equal(agent.getCurrentAgentStates().compactMemory, "Landing page: hero done, footer next.");
    });

    test("without compactInstructions the prompt has no COMPACTION block", async () => {
        const seen: Message[][] = [];
        const provider = new ScriptedProvider("plain", [({ messages }) => {
            seen.push(messages);
            return { content: "ok" };
        }]);
        await agentWith(provider).run("hello");
        assert.doesNotMatch(systemPrompt(seen[0]!), /COMPACTION:/);
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
