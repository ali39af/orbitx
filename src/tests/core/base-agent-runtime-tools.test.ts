import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BaseAgent, MCPClient, MCPConnection, MCPServer, MCPTool } from "../../index.js";
import type { ToolSchema } from "../../index.js";
import { ScriptedProvider, lastToolOutput } from "./scripted-provider.js";

function echoTool(name: string, reply: any = { ok: name }) {
    return new MCPTool({ name, description: `${name} tool`, inputs: [], execute: async () => reply });
}

/** Records the tool names sent to the provider on every turn. */
function recordTools(provider: ScriptedProvider): string[][] {
    const seen: string[][] = [];
    const chat = provider.chat.bind(provider);
    provider.chat = (messages, stream, tools?: ToolSchema[], signal?) => {
        seen.push((tools ?? []).map(t => t.name));
        return chat(messages, stream, tools, signal);
    };
    return seen;
}

/** A loopback server + client; `tools` are registered on the server, the way an app registers them itself. */
function wired(tools: MCPTool[] = [], id = "runtime-tools") {
    const connection = new MCPConnection();
    const server = new MCPServer(connection);
    for (const tool of tools) server.registerTool(tool);
    return { server, client: new MCPClient(id, connection) };
}

describe("core/base-agent runtime tools", () => {
    test("addTools between runs: the next run offers and dispatches the new tool", async () => {
        const weather = echoTool("weather", { temp: 21 });
        const { client } = wired([weather]);
        const provider = new ScriptedProvider("between", [
            () => ({ content: "hi" }),
            () => ({ toolCalls: [{ name: "weather", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], aiProvider: provider, mcpClient: client });

        await agent.run("hello");
        assert.deepEqual(agent.addTools(weather), ["weather"]);
        await agent.run("weather?");

        assert.deepEqual(seen[0], ["compact_memory"]);
        assert.ok(seen[1]!.includes("weather"));
        assert.deepEqual(lastToolOutput(agent.getCurrentAgentStates().messagesCompact, "weather"), { temp: 21 });
    });

    test("addTools never registers: an unregistered tool is offered, and calling it returns 'not available'", async () => {
        const { client } = wired();
        const provider = new ScriptedProvider("unregistered", [
            () => ({ toolCalls: [{ name: "nowhere", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], aiProvider: provider, mcpClient: client });

        agent.addTools(echoTool("nowhere"));
        await agent.run("go");

        assert.ok(seen[0]!.includes("nowhere"), "the model is told it has the tool");
        assert.equal(client.hasLocalTool("nowhere"), false);
        const result = agent.getCurrentAgentStates().messagesCompact.find(m => m.role === "tool")!;
        assert.match(result.content!, /"nowhere" is not available/);
    });

    test("a tool registered after the schemas were read is still found", async () => {
        const late = echoTool("late", { ok: true });
        const { server, client } = wired();
        const provider = new ScriptedProvider("late", [
            () => {
                server.registerTool(late);
                return { toolCalls: [{ name: "late", inputs: {} }] };
            },
            () => ({ content: "done" }),
        ]);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [late], aiProvider: provider, mcpClient: client });

        await agent.run("go");

        assert.deepEqual(lastToolOutput(agent.getCurrentAgentStates().messagesCompact, "late"), { ok: true });
    });

    test("a tool can unlock more tools mid-run; they appear on the very next turn", async () => {
        const secret = echoTool("secret", { value: 42 });
        let agent!: BaseAgent;
        const loader = new MCPTool({
            name: "load_toolset", description: "loads more tools", inputs: [],
            execute: async () => ({ loaded: agent.addTools(secret) }),
        });
        const { client } = wired([loader, secret]);
        const provider = new ScriptedProvider("midrun", [
            () => ({ toolCalls: [{ name: "load_toolset", inputs: {} }] }),
            () => ({ toolCalls: [{ name: "secret", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        agent = new BaseAgent({ instruction: "t", allowedTools: [loader], aiProvider: provider, mcpClient: client });

        await agent.run("go");

        assert.ok(!seen[0]!.includes("secret"));
        assert.ok(seen[1]!.includes("secret"));
        assert.deepEqual(lastToolOutput(agent.getCurrentAgentStates().messagesCompact, "secret"), { value: 42 });
    });

    test("removeTools: gone from the next turn, a stale call is refused, the registration stays", async () => {
        let agent!: BaseAgent;
        const dropMe = new MCPTool({
            name: "drop_me", description: "removes itself", inputs: [],
            execute: async () => ({ removed: agent.removeTools("drop_me") }),
        });
        const { client } = wired([], "remove");
        client.registerTool(dropMe);
        const provider = new ScriptedProvider("remove", [
            () => ({ toolCalls: [{ name: "drop_me", inputs: {} }] }),
            () => ({ toolCalls: [{ name: "drop_me", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        agent = new BaseAgent({ instruction: "t", allowedTools: [dropMe], aiProvider: provider, mcpClient: client });

        await agent.run("go");

        assert.ok(seen[0]!.includes("drop_me"));
        assert.ok(!seen[1]!.includes("drop_me"));
        const toolMessages = agent.getCurrentAgentStates().messagesCompact.filter(m => m.role === "tool");
        assert.match(toolMessages.at(-1)!.content!, /not found or not allowed/);
        assert.ok(client.hasLocalTool("drop_me"), "removeTools only changes the allow-list");
    });

    test("use_tool: the model enables a toolbox tool itself and uses it next turn", async () => {
        const toolbox = [echoTool("weather", { temp: 21 }), echoTool("stocks")];
        const { client } = wired(toolbox);
        const provider = new ScriptedProvider("use", [
            () => ({ toolCalls: [{ name: "use_tool", inputs: { names: "weather" } }] }),
            () => ({ toolCalls: [{ name: "weather", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], toolbox, aiProvider: provider, mcpClient: client });

        await agent.run("weather?");

        assert.ok(seen[0]!.includes("use_tool") && !seen[0]!.includes("weather"));
        assert.ok(seen[1]!.includes("weather"));
        const messages = agent.getCurrentAgentStates().messagesCompact;
        assert.deepEqual(lastToolOutput(messages, "use_tool"), { enabled: ["weather"], alreadyEnabled: [], unknown: [] });
        assert.deepEqual(lastToolOutput(messages, "weather"), { temp: 21 });
    });

    test("use_tool can't reach outside the toolbox, and disappears once everything is enabled", async () => {
        const only = echoTool("only");
        const { client } = wired([only, echoTool("bash_run")]);
        const provider = new ScriptedProvider("limit", [
            () => ({ toolCalls: [{ name: "use_tool", inputs: { names: "only, bash_run" } }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], toolbox: [only], aiProvider: provider, mcpClient: client });

        await agent.run("go");

        assert.deepEqual(lastToolOutput(agent.getCurrentAgentStates().messagesCompact, "use_tool"), { enabled: ["only"], alreadyEnabled: [], unknown: ["bash_run"] });
        assert.ok(!seen[1]!.includes("use_tool"), "nothing left to enable");
        assert.ok(!seen[1]!.includes("bash_run"), "registered on the server, but outside the toolbox");
        assert.deepEqual(agent.getAllowedTools().map(t => t.getOptions().name), ["only"]);
    });

    test("without a toolbox, use_tool is never offered and a call to it is refused", async () => {
        const { client } = wired();
        const provider = new ScriptedProvider("no-toolbox", [
            () => ({ toolCalls: [{ name: "use_tool", inputs: { names: "anything" } }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], aiProvider: provider, mcpClient: client });

        await agent.run("go");

        assert.ok(!seen[0]!.includes("use_tool"));
        const result = agent.getCurrentAgentStates().messagesCompact.find(m => m.role === "tool")!;
        assert.match(result.content!, /not found or not allowed/);
    });

    test("recovery: use_tool calls in restored state are replayed at construction", async () => {
        const toolbox = () => [echoTool("weather", { temp: 21 }), echoTool("stocks")];
        const before = toolbox();
        const first = new BaseAgent({
            instruction: "t", allowedTools: [], toolbox: before, mcpClient: wired(before).client,
            aiProvider: new ScriptedProvider("before", [
                () => ({ toolCalls: [{ name: "use_tool", inputs: { names: "weather" } }] }),
                () => ({ toolCalls: [{ name: "compact_memory", inputs: { new_memory: "weather enabled", continue_iterating: false } }] }),
            ]),
        });
        await first.run("enable weather");
        const saved = JSON.parse(JSON.stringify(first.getCurrentAgentStates()));
        assert.equal(saved.messagesCompact.length, 0, "the use_tool call now lives only in retiredMessages");

        const after = toolbox();
        const provider = new ScriptedProvider("after", [
            () => ({ toolCalls: [{ name: "weather", inputs: {} }] }),
            () => ({ content: "done" }),
        ]);
        const seen = recordTools(provider);
        const restored = new BaseAgent({ instruction: "t", allowedTools: [], toolbox: after, mcpClient: wired(after).client, aiProvider: provider, initData: saved });

        assert.deepEqual(restored.getAllowedTools().map(t => t.getOptions().name), ["weather"], "restored before the first run");
        await restored.run("weather now?");

        assert.ok(seen[0]!.includes("weather") && !seen[0]!.includes("stocks"));
        assert.deepEqual(lastToolOutput(restored.getCurrentAgentStates().messagesCompact, "weather"), { temp: 21 });
    });

    test("recovery with a narrower toolbox skips names no longer in it", () => {
        const saved = {
            compactMemory: "",
            retiredMessages: [],
            messagesCompact: [
                { role: "user" as const, content: "go" },
                { role: "assistant" as const, content: "", toolCalls: [{ id: "c1", name: "use_tool", inputs: { names: "weather, stocks" } }] },
                { role: "tool" as const, toolCallId: "c1", toolName: "use_tool", content: "{}" },
            ],
        };
        const agent = new BaseAgent({
            instruction: "t", allowedTools: [], toolbox: [echoTool("stocks")], mcpClient: wired().client,
            aiProvider: new ScriptedProvider("narrow", []), initData: saved,
        });
        assert.deepEqual(agent.getAllowedTools().map(t => t.getOptions().name), ["stocks"]);
    });

    test("reserved names are rejected, and same-name tools are replaced", () => {
        const agent = new BaseAgent({ instruction: "t", allowedTools: [], aiProvider: new ScriptedProvider("reserved", []), mcpClient: wired().client });

        assert.throws(() => agent.addTools(echoTool("compact_memory")), /reserved/);
        assert.throws(() => agent.addTools(echoTool("use_tool")), /reserved/);
        assert.throws(() => agent.setToolbox([echoTool("use_tool")]), /reserved/);

        const first = echoTool("dup");
        const second = echoTool("dup");
        agent.addTools(first);
        agent.addTools(second);
        assert.deepEqual(agent.getAllowedTools(), [second]);

        agent.setTools([echoTool("only")]);
        assert.deepEqual(agent.getAllowedTools().map(t => t.getOptions().name), ["only"]);
    });
});
