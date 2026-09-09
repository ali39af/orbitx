import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MCPAutoExecutionPolicy, type MCPToolCallRequest } from "../../index.js";
import { ScriptedProvider } from "./scripted-provider.js";

const request = (overrides: Partial<MCPToolCallRequest> = {}): MCPToolCallRequest => ({
    toolName: "bash-run",
    inputs: { command: "rm -rf /" },
    envID: "env",
    toolCallId: "call-1",
    ...overrides,
});

describe("core/mcp-auto-execution-policy", () => {
    test("authorize(): an unwatched tool is authorized immediately, no model call, no verdict recorded", async () => {
        const provider = new ScriptedProvider("p", () => ({ content: "should never be called" }));
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider });

        const authorized = await policy.authorize(request({ toolName: "get-current-time", inputs: {}, toolCallId: "call-time" }));

        assert.strictEqual(authorized, true);
        assert.strictEqual(provider.getCallCount(), 0);
        assert.strictEqual(policy.getVerdict("call-time"), undefined);
    });

    test("authorize(): bash-run always goes to the model — no path field to short-circuit on", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { harmful: true, reason: "destroys the filesystem" } }],
        }));

        const policy = new MCPAutoExecutionPolicy({ aiModel: provider });
        const authorized = await policy.authorize(request());

        assert.strictEqual(authorized, false);
        assert.strictEqual(provider.getCallCount(), 1);
    });

    test("authorize(): a watched fs call whose path resolves inside scope is authorized locally, no model call", async () => {
        const provider = new ScriptedProvider("p", () => ({ content: "should never be called" }));
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, scopeDir: process.cwd() });

        const authorized = await policy.authorize(request({
            toolName: "fs-write-file",
            inputs: { path: "some/nested/file.txt", content: "hello" },
            toolCallId: "call-write-in-scope",
        }));

        assert.strictEqual(authorized, true);
        assert.strictEqual(provider.getCallCount(), 0);
        assert.strictEqual(policy.getVerdict("call-write-in-scope")!.harmful, false);
        assert.match(policy.getVerdict("call-write-in-scope")!.reason, /skipped model review/);
    });

    test("authorize(): a watched fs call whose path resolves outside scope escalates to the model", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { harmful: true, reason: "writes outside the project" } }],
        }));
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, scopeDir: process.cwd() });

        const authorized = await policy.authorize(request({
            toolName: "fs-write-file",
            inputs: { path: "../../outside.txt", content: "hello" },
        }));

        assert.strictEqual(authorized, false);
        assert.strictEqual(provider.getCallCount(), 1);
    });

    test("authorize(): fs-move requires BOTH from and to inside scope to skip the model", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { harmful: false, reason: "fine" } }],
        }));
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, scopeDir: process.cwd() });

        await policy.authorize(request({
            toolName: "fs-move",
            inputs: { from: "in-scope.txt", to: "../outside.txt" },
        }));

        assert.strictEqual(provider.getCallCount(), 1, "one path outside scope forces a model review");
    });

    test("authorize(): file content is stripped before it ever reaches the model", async () => {
        let seenPrompt = "";
        const provider = new ScriptedProvider("p", ({ messages }) => {
            seenPrompt = messages.at(-1)?.content ?? "";
            return { toolCalls: [{ name: "submit_answer", inputs: { harmful: false, reason: "fine" } }] };
        });
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, scopeDir: "/some/other/scope" });

        await policy.authorize(request({
            toolName: "fs-write-file",
            inputs: { path: "secrets.txt", content: "super-secret-password-do-not-leak-this" },
        }));

        assert.doesNotMatch(seenPrompt, /super-secret-password-do-not-leak-this/);
        assert.match(seenPrompt, /omitted, \d+ bytes/);
    });

    test("getVerdict() / getLastVerdict() / onVerdict expose the reviewed verdict", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { harmful: true, reason: "irreversible deletion" } }],
        }));

        const calls: { request: MCPToolCallRequest; verdict: any }[] = [];
        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, onVerdict: (request, verdict) => calls.push({ request, verdict }) });

        await policy.authorize(request({ toolCallId: "call-42" }));

        assert.deepStrictEqual(policy.getVerdict("call-42"), { harmful: true, reason: "irreversible deletion" });
        assert.deepStrictEqual(policy.getLastVerdict(), { harmful: true, reason: "irreversible deletion" });
        assert.strictEqual(calls.length, 1);
    });

    test("authorize(): fails closed (denies) when the safety check itself can't produce a valid verdict", async () => {
        const provider = new ScriptedProvider("p", () => ({ content: "I refuse to answer in JSON" }));

        const policy = new MCPAutoExecutionPolicy({ aiModel: provider });
        const authorized = await policy.authorize(request());

        assert.strictEqual(authorized, false);
        assert.strictEqual(policy.getVerdict("call-1")!.harmful, true);
    });

    test("watchedTools: a custom set overrides the default", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { harmful: true, reason: "not allowed at all" } }],
        }));

        const policy = new MCPAutoExecutionPolicy({ aiModel: provider, watchedTools: ["todo-remove-list"] });

        assert.strictEqual(await policy.authorize(request({ toolName: "bash-run" })), true, "bash-run isn't watched anymore");
        assert.strictEqual(await policy.authorize(request({ toolName: "todo-remove-list", inputs: {} })), false);
    });
});
