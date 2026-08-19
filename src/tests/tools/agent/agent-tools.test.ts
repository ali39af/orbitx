import { test } from "node:test";
import assert from "node:assert/strict";
import {
    AIProvider,
    AgentReportTool,
    AgentTools,
    MCPClient,
    MCPConnection,
    MCPServer,
    WorkerAgent,
    type ChatResponse,
    type Message,
    type ProviderCapabilities,
    type StreamCallback,
    type ToolCallRequest,
    type ToolSchema,
} from "../../../index.js";

/**
 * Returns a fixed, scripted response (or repeats the last one once
 * exhausted) instead of calling a real model — lets the agent-management
 * tools be tested end to end (hire -> prompt -> worker's own tool loop ->
 * report) with no network access.
 */
class ScriptedProvider extends AIProvider {
    #responses: ChatResponse[];
    #calls = 0;

    constructor(responses: ChatResponse[]) {
        super();
        this.#responses = responses;
    }

    async chat(_messages: Message[], streamCallback?: StreamCallback, _tools?: ToolSchema[]): Promise<ChatResponse> {
        const response = this.#responses[Math.min(this.#calls, this.#responses.length - 1)];
        this.#calls++;

        if (streamCallback) {
            if (response.content) {
                await streamCallback({ role: "assistant", content: response.content, done: false });
            }
            await streamCallback({
                role: "assistant",
                content: "",
                done: true,
                ...(response.toolCalls?.length ? { toolCalls: response.toolCalls } : {}),
            });
        }

        return response;
    }

    getCapabilities(): ProviderCapabilities {
        return { supportsTools: true, supportsImages: false, contextWindow: 200_000, safeUsageRatio: 0.9 };
    }
}

function buildWorker(name: string, description: string, responses: ChatResponse[]): WorkerAgent {
    const connection = new MCPConnection();
    const server = new MCPServer(connection);
    const reportTool = AgentReportTool();
    server.registerTool(reportTool);
    const mcpClient = new MCPClient(`worker-${name}`, connection);

    return new WorkerAgent({
        name,
        description,
        rating: { backend: 8, frontend: 3 },
        instruction: "You are a worker agent.",
        aiProvider: new ScriptedProvider(responses),
        mcpClient,
        allowedTools: [reportTool],
    });
}

test("AgentTools: agent-list shows every worker, unhired by default", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "unused", inputTokens: 0, outputTokens: 0 }]);
    const [listTool] = AgentTools([worker]);

    const result: any = await listTool.getOptions().execute("env", {});
    assert.strictEqual(result.agents.length, 1);
    assert.strictEqual(result.agents[0].name, "backend-worker");
    assert.strictEqual(result.agents[0].description, "Handles backend tasks.");
    assert.deepStrictEqual(result.agents[0].rating, { backend: 8, frontend: 3 });
    assert.strictEqual(result.agents[0].hired, false);
});

test("AgentTools: agent-hire marks a worker hired, reflected in agent-list", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "unused", inputTokens: 0, outputTokens: 0 }]);
    const [listTool, hireTool] = AgentTools([worker]);

    const hireResult: any = await hireTool.getOptions().execute("env", { name: "backend-worker" });
    assert.deepStrictEqual(hireResult, { hired: true, name: "backend-worker" });

    const listResult: any = await listTool.getOptions().execute("env", {});
    assert.strictEqual(listResult.agents[0].hired, true);
});

test("AgentTools: agent-hire on an unknown name throws", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "unused", inputTokens: 0, outputTokens: 0 }]);
    const [, hireTool] = AgentTools([worker]);

    await assert.rejects(
        () => hireTool.getOptions().execute("env", { name: "nonexistent" }),
        /no worker agent named "nonexistent"/
    );
});

test("AgentTools: agent-prompt on a worker that isn't hired yet throws", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "unused", inputTokens: 0, outputTokens: 0 }]);
    const [, , promptTool] = AgentTools([worker]);

    await assert.rejects(
        () => promptTool.getOptions().execute("env", { name: "backend-worker", prompt: "do it" }),
        /is not hired yet/
    );
});

test("AgentTools: agent-prompt runs the worker and returns its agent-report text", async () => {
    const reportCall: ToolCallRequest = { id: "call-1", name: "agent-report", inputs: { report: "answer is 42" } };
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [
        { content: "", inputTokens: 10, outputTokens: 5, toolCalls: [reportCall] },
    ]);
    const [, hireTool, promptTool] = AgentTools([worker]);

    await hireTool.getOptions().execute("env", { name: "backend-worker" });
    const result: any = await promptTool.getOptions().execute("env", { name: "backend-worker", prompt: "what is the answer?" });

    assert.strictEqual(result.reported, true);
    assert.strictEqual(result.report, "answer is 42");
});

test("AgentTools: agent-prompt falls back to the worker's last assistant text when it never calls agent-report", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [
        { content: "I looked into it, no tool needed.", inputTokens: 10, outputTokens: 5 },
    ]);
    const [, hireTool, promptTool] = AgentTools([worker]);

    await hireTool.getOptions().execute("env", { name: "backend-worker" });
    const result: any = await promptTool.getOptions().execute("env", { name: "backend-worker", prompt: "check something" });

    assert.strictEqual(result.reported, false);
    assert.strictEqual(result.report, "I looked into it, no tool needed.");
});

test("AgentTools: a second agent-prompt call doesn't resurface a stale report from the first call", async () => {
    const reportCall: ToolCallRequest = { id: "call-1", name: "agent-report", inputs: { report: "first answer" } };
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [
        { content: "", inputTokens: 10, outputTokens: 5, toolCalls: [reportCall] },
        { content: "just acknowledging, no report this time", inputTokens: 10, outputTokens: 5 },
    ]);
    const [, hireTool, promptTool] = AgentTools([worker]);

    await hireTool.getOptions().execute("env", { name: "backend-worker" });
    await promptTool.getOptions().execute("env", { name: "backend-worker", prompt: "first task" });
    const second: any = await promptTool.getOptions().execute("env", { name: "backend-worker", prompt: "second task" });

    assert.strictEqual(second.reported, false);
    assert.strictEqual(second.report, "just acknowledging, no report this time");
});

test("AgentTools: duplicate worker names are rejected at construction", async () => {
    const workerA = buildWorker("dup", "A", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const workerB = buildWorker("dup", "B", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);

    assert.throws(() => AgentTools([workerA, workerB]), /duplicate worker agent name "dup"/);
});

test("AgentTools: maxHired is mentioned dynamically in agent-hire's description", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const [, hireTool] = AgentTools([worker], { maxHired: 2 });

    assert.match(hireTool.getOptions().description, /At most 2 worker agents may be hired at once/);
});

test("AgentTools: agent-hire has no limit note when maxHired is omitted", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const [, hireTool] = AgentTools([worker]);

    assert.doesNotMatch(hireTool.getOptions().description, /At most/);
});

test("AgentTools: hiring beyond maxHired throws, but re-hiring an already-hired worker doesn't count against it", async () => {
    const workerA = buildWorker("worker-a", "A", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const workerB = buildWorker("worker-b", "B", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const workerC = buildWorker("worker-c", "C", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const [listTool, hireTool] = AgentTools([workerA, workerB, workerC], { maxHired: 1 });

    await hireTool.getOptions().execute("env", { name: "worker-a" });
    // re-hiring the same worker is a no-op, must not count twice against the limit
    await hireTool.getOptions().execute("env", { name: "worker-a" });

    await assert.rejects(
        () => hireTool.getOptions().execute("env", { name: "worker-b" }),
        /maximum of 1 hired agent\(s\) already reached/
    );

    const listResult: any = await listTool.getOptions().execute("env", {});
    assert.strictEqual(listResult.hiredCount, 1);
    assert.strictEqual(listResult.maxHired, 1);
});

test("AgentTools: agent-list omits maxHired when no limit was configured", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);
    const [listTool] = AgentTools([worker]);

    const result: any = await listTool.getOptions().execute("env", {});
    assert.strictEqual(result.hiredCount, 0);
    assert.strictEqual("maxHired" in result, false);
});

test("AgentTools: maxHired must be a positive integer when given", async () => {
    const worker = buildWorker("backend-worker", "Handles backend tasks.", [{ content: "x", inputTokens: 0, outputTokens: 0 }]);

    assert.throws(() => AgentTools([worker], { maxHired: 0 }), /maxHired must be a positive integer/);
    assert.throws(() => AgentTools([worker], { maxHired: -1 }), /maxHired must be a positive integer/);
    assert.throws(() => AgentTools([worker], { maxHired: 1.5 }), /maxHired must be a positive integer/);
});
