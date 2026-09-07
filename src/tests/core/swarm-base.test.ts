import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    SwarmBase,
    AgentDefinition,
    MCPTool,
    getAgentTools,
    selectTools,
    GetCurrentTimeTool,
} from "../../index.js";
import type { AgentProvidersInput, AgentToolsHandle, AIProvider, SwarmState } from "../../index.js";
import { ScriptedProvider, lastToolOutput, lastUserMessage, type ScriptedTurn } from "./scripted-provider.js";

interface SwarmFixture {
    plannerScript: ScriptedTurn | ScriptedTurn[];
    workerScript?: ScriptedTurn | ScriptedTurn[];
    maxHired?: number;
    initData?: SwarmState;
    /** Registered on the swarm as the `image-describer`, for the tool below. */
    describer?: AIProvider;
    features?: { executeProviderFromMCPTool?: boolean };
}

const idle: ScriptedTurn = () => ({ content: "idle" });

/** A tool that reaches for a provider mid-call — the thing `executeProvider` exists for. */
const DescribeTool = () => new MCPTool({
    name: "describe",
    description: "asks for a description",
    inputs: [],
    execute: async (_envID, _inputs, toolCallId, mcp) =>
        mcp!.executeProvider(toolCallId!, "image-describer", { content: "describe this" }),
});

function buildSwarm({ plannerScript, workerScript = idle, maxHired, initData, describer, features }: SwarmFixture) {
    const agentTools = getAgentTools({ maxHired });
    const tools = [...agentTools.tools, GetCurrentTimeTool(), DescribeTool()];

    const plannerProvider = new ScriptedProvider("planner", plannerScript);
    const workerProvider = new ScriptedProvider("worker", workerScript);

    const planner = new AgentDefinition({
        type: "planner",
        description: "hires and coordinates",
        instruction: "You are the planner.",
        tools: selectTools(tools, ["agent-types", "agent-hire", "agent-fire", "agent-active", "agent-prompt"]),
        aiProvider: plannerProvider,
    });

    const worker = new AgentDefinition({
        type: "worker",
        description: "does the work",
        rating: { work: 10 },
        instruction: "You are a worker.",
        tools: selectTools(tools, ["agent-report-parent", "agent-report-group", "get-current-time", "describe"]),
        aiProvider: workerProvider,
    });

    const swarmProvider: AgentProvidersInput = describer
        ? [{ type: "main", provider: new ScriptedProvider("unused", idle) }, { type: "image-describer", provider: describer }]
        : new ScriptedProvider("unused", idle);

    const swarm = new SwarmBase({
        tools,
        agents: [planner, worker],
        default: "planner",
        agentTools,
        aiProvider: swarmProvider,
        ...(features ? { features } : {}),
        ...(initData ? { initData } : {}),
    });

    return { swarm, plannerProvider, workerProvider, agentTools };
}

/** Every message an agent holds, retired and current, as one searchable blob. */
function transcript(swarm: SwarmBase, agentId: string): string {
    const agent = swarm.getAgent(agentId);
    assert.ok(agent, `no agent "${agentId}" in this swarm`);
    const state = agent.getCurrentAgentStates();
    return [...state.retiredMessages, ...state.messagesCompact]
        .map(m => `${m.role}: ${m.content ?? ""}`)
        .join("\n");
}

/**
 * Call an agent tool exactly the way the agent would: from inside that agent's
 * own turn. Hiring, firing and reporting are things agents ask for, so this is
 * the only way to ask for them — the swarm has no such methods of its own.
 */
const callAs = (handle: AgentToolsHandle, agentId: string, name: string, inputs: Record<string, any> = {}) => {
    const tool = handle.tools.find(t => t.getOptions().name === name);
    assert.ok(tool, `no tool named ${name}`);
    return handle.runAs(agentId, () => tool.getOptions().execute("ENV", inputs));
};

/** Hire a worker, task it, then stop talking — the planner half of the round trip. */
const hireAndDispatch: ScriptedTurn[] = [
    () => ({ toolCalls: [{ name: "agent-hire", inputs: { type: "worker" } }] }),
    ({ messages }) => ({
        toolCalls: [{
            name: "agent-prompt",
            inputs: { agentId: lastToolOutput(messages, "agent-hire").agentId, prompt: "do the thing" },
        }],
    }),
    () => ({ content: "dispatched, my turn is over" }),
];

/**
 * Reach for the provider once, then stop. Keyed off this agent's own messages
 * rather than the provider's call count, because every worker in a swarm shares
 * one ScriptedProvider.
 */
const describeOnce: ScriptedTurn = ({ messages }) =>
    messages.some(m => m.role === "tool")
        ? { content: "done looking" }
        : { toolCalls: [{ name: "describe", inputs: {} }] };

/** Do the task, report, stop — the worker half. */
const reportBack: ScriptedTurn = ({ messages }) =>
    lastUserMessage(messages).includes("[task from")
        ? { toolCalls: [{ name: "agent-report-parent", inputs: { report: "WORK DONE" } }] }
        : { content: "nothing to do" };

describe("core/swarm-base", () => {
    test("run() hires, dispatches, and only resolves once the hired agent has reported", async () => {
        const { swarm, plannerProvider } = buildSwarm({
            plannerScript: hireAndDispatch,
            workerScript: reportBack,
        });

        const done = await swarm.run("build the thing");

        assert.strictEqual(done, true);
        assert.match(transcript(swarm, "worker-1"), /do the thing/);
        assert.match(transcript(swarm, "worker-1"), /task from planner-1/);
        // The planner was woken by the report after its own turn had ended —
        // which is the whole point: run() outlived the planner's last word.
        assert.match(transcript(swarm, "planner-1"), /WORK DONE/);
        assert.ok(plannerProvider.getCallCount() >= 4, `planner should have been woken again, got ${plannerProvider.getCallCount()} turns`);
        assert.deepStrictEqual(swarm.getFailures(), []);

        swarm.close();
    });

    test("streamed chunks are tagged with the agent that produced them", async () => {
        const { swarm } = buildSwarm({ plannerScript: hireAndDispatch, workerScript: reportBack });

        const seen = new Set<string>();
        await swarm.run("build the thing", chunk => { seen.add(chunk.agentId); });

        assert.deepStrictEqual([...seen].sort(), ["planner-1", "worker-1"]);
        swarm.close();
    });

    test("a group message reaches the sender's peers and never the parent", async () => {
        const plannerScript: ScriptedTurn[] = [
            () => ({ toolCalls: [{ name: "agent-hire", inputs: { type: "worker", group: "api" } }] }),
            () => ({ toolCalls: [{ name: "agent-hire", inputs: { type: "worker", group: "api" } }] }),
            () => ({ toolCalls: [{ name: "agent-prompt", inputs: { agentId: "worker-1", prompt: "start" } }] }),
            () => ({ content: "dispatched" }),
        ];

        const workerScript: ScriptedTurn = ({ messages }) => {
            if (lastUserMessage(messages).includes("group \"api\" message")) return { content: "noted" };
            if (messages.some(m => m.role === "tool" && m.toolName === "agent-report-group")) {
                return { toolCalls: [{ name: "agent-report-parent", inputs: { report: "WORK DONE" } }] };
            }
            return { toolCalls: [{ name: "agent-report-group", inputs: { message: "SHARED NOTE" } }] };
        };

        const { swarm } = buildSwarm({ plannerScript, workerScript });
        const done = await swarm.run("build the thing");

        assert.strictEqual(done, true);
        assert.match(transcript(swarm, "worker-2"), /SHARED NOTE/);
        assert.doesNotMatch(transcript(swarm, "planner-1"), /SHARED NOTE/);
        assert.match(transcript(swarm, "planner-1"), /WORK DONE/);

        swarm.close();
    });

    test("run() goes to the entrypoint agent by default, and to a named agent when asked", async () => {
        const workerScript: ScriptedTurn = () => ({ content: "answered" });
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle, workerScript });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });

        await swarm.run("a question for the planner");
        assert.match(transcript(swarm, "planner-1"), /a question for the planner/);

        // Straight to the worker: no parent in the middle, and no "[task from …]"
        // wrapper — this is the user talking, not another agent.
        const done = await swarm.run("a question for the worker", { agentId: "worker-1" });

        assert.strictEqual(done, true);
        assert.match(transcript(swarm, "worker-1"), /user: a question for the worker/);
        assert.doesNotMatch(transcript(swarm, "worker-1"), /task from/);
        assert.doesNotMatch(transcript(swarm, "planner-1"), /a question for the worker/);

        swarm.close();
    });

    test("run() refuses an agent that has been fired", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await callAs(agentTools, "planner-1", "agent-fire", { agentId: "worker-1" });

        await assert.rejects(() => swarm.run("hello", { agentId: "worker-1" }), /has been fired/);
        await assert.rejects(() => swarm.run("hello", { agentId: "ghost-1" }), /no agent "ghost-1"/);

        swarm.close();
    });

    test("the hire cap is one shared pool, and firing gives the slot back", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle, maxHired: 1 });

        const first = await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        assert.strictEqual(first.agentId, "worker-1");

        await assert.rejects(
            () => callAs(agentTools, "planner-1", "agent-hire", { type: "worker" }),
            /shared limit of 1 hired agent/
        );

        await callAs(agentTools, "planner-1", "agent-fire", { agentId: "worker-1" });

        const second = await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        assert.strictEqual(second.agentId, "worker-2");
        assert.strictEqual(second.remaining, 0);

        swarm.close();
    });

    test("the entrypoint agent holds no hire slot and cannot be fired", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle, maxHired: 1 });

        assert.strictEqual(swarm.getMainAgentId(), "planner-1");
        assert.strictEqual((await callAs(agentTools, "planner-1", "agent-types")).hired, 0);
        await assert.rejects(
            () => callAs(agentTools, "planner-1", "agent-fire", { agentId: "planner-1" }),
            /entrypoint agent cannot be fired/
        );

        swarm.close();
    });

    test("only the agent that hired someone can prompt or fire them", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });

        await assert.rejects(() => callAs(agentTools, "worker-1", "agent-fire", { agentId: "worker-2" }), /only planner-1/);
        await assert.rejects(() => callAs(agentTools, "worker-1", "agent-prompt", { agentId: "worker-2", prompt: "x" }), /only planner-1/);

        await callAs(agentTools, "planner-1", "agent-fire", { agentId: "worker-1" });
        await assert.rejects(() => callAs(agentTools, "planner-1", "agent-prompt", { agentId: "worker-1", prompt: "x" }), /has been fired/);
        await assert.rejects(() => callAs(agentTools, "planner-1", "agent-fire", { agentId: "worker-1" }), /already fired/);
        await assert.rejects(() => callAs(agentTools, "worker-1", "agent-hire", { type: "worker" }), /fired agent cannot hire/);

        swarm.close();
    });

    test("hiring an unknown type lists the types that do exist", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });

        await assert.rejects(
            () => callAs(agentTools, "planner-1", "agent-hire", { type: "designer" }),
            /no agent type "designer".*planner, worker/s
        );

        swarm.close();
    });

    test("reporting has to have somewhere to go", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });

        await assert.rejects(() => callAs(agentTools, "planner-1", "agent-report-parent", { report: "x" }), /no parent/);

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await assert.rejects(() => callAs(agentTools, "worker-1", "agent-report-group", { message: "x" }), /not in any group/);

        swarm.close();
    });

    test("listTypes and listAgents describe the live roster", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle, maxHired: 4 });
        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker", group: "api" });

        const types = swarm.listTypes();
        assert.deepStrictEqual(types.map(t => t.type).sort(), ["planner", "worker"]);
        assert.strictEqual(types.find(t => t.type === "worker")?.active, 1);
        assert.strictEqual(types.find(t => t.type === "planner")?.active, 0);
        assert.deepStrictEqual(types.find(t => t.type === "worker")?.rating, { work: 10 });

        assert.deepStrictEqual(swarm.listAgents(), [
            { agentId: "planner-1", type: "planner", groups: [], active: true, busy: false, awaitingReport: false },
            { agentId: "worker-1", type: "worker", parentId: "planner-1", groups: ["api"], active: true, busy: false, awaitingReport: false },
        ]);
        assert.strictEqual(swarm.getAgentInfo("nobody-1"), undefined);
        assert.strictEqual(swarm.isEntrypoint("planner-1"), true);
        assert.strictEqual(swarm.isEntrypoint("worker-1"), false);

        swarm.close();
    });

    test("a briefing given at hire time is appended to the agent's standing instruction", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker", briefing: "This project uses Postgres." });
        const worker = swarm.getAgent("worker-1");

        assert.ok(worker);
        // Reaches the model through the system prompt, so the simplest honest
        // check is that hiring twice with different briefings gives different agents.
        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker", briefing: "This project uses MySQL." });
        assert.notStrictEqual(swarm.getAgent("worker-2"), worker);

        swarm.close();
    });

    test("swarm state round-trips: ids, parents, groups, conversations, and the id counter", async () => {
        const { swarm } = buildSwarm({ plannerScript: hireAndDispatch, workerScript: reportBack });
        await swarm.run("build the thing");
        const saved = swarm.getCurrentSwarmStates();
        swarm.close();

        // Plain JSON, so it survives a file or a database on the way back.
        const { swarm: restored, agentTools } = buildSwarm({ plannerScript: idle, initData: JSON.parse(JSON.stringify(saved)) });

        assert.strictEqual(restored.getMainAgentId(), "planner-1");
        assert.deepStrictEqual(restored.getAgentIds(), ["planner-1", "worker-1"]);
        assert.strictEqual(restored.getAgentInfo("worker-1")?.parentId, "planner-1");
        assert.match(transcript(restored, "worker-1"), /do the thing/);
        assert.match(transcript(restored, "planner-1"), /WORK DONE/);

        // Ids continue from what was restored rather than colliding with it.
        const next = await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        assert.strictEqual(next.agentId, "worker-2");

        restored.close();
    });

    test("who was fired is not saved — a restored roster comes back hired", async () => {
        const { swarm, agentTools } = buildSwarm({ plannerScript: idle });
        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await callAs(agentTools, "planner-1", "agent-fire", { agentId: "worker-1" });

        assert.strictEqual(swarm.getAgentInfo("worker-1")?.active, false);
        const saved = swarm.getCurrentSwarmStates();
        swarm.close();

        assert.ok(saved.agents.every(agent => !("active" in agent)), "active must not be part of the saved state");

        const { swarm: restored } = buildSwarm({ plannerScript: idle, initData: saved });
        assert.strictEqual(restored.getAgentInfo("worker-1")?.active, true);
        restored.close();
    });

    test("restoring with a default that isn't in the saved roster is rejected", () => {
        assert.throws(
            () => buildSwarm({
                plannerScript: idle,
                initData: { default: "ghost-1", agents: [] },
            }),
            /initData.default "ghost-1" is not one of the restored agents/
        );
    });

    test("concurrent run() calls: the older one ends with the planner's turn, the newest owns the finish", async () => {
        const slowThenIdle: ScriptedTurn = ({ call }) => (call === 0 ? { content: "thinking", delayMs: 30 } : { content: "done" });
        const { swarm } = buildSwarm({ plannerScript: slowThenIdle });

        const first = swarm.run("first");
        const second = swarm.run("second");

        assert.strictEqual(await first, false);
        assert.strictEqual(await second, true);

        assert.match(transcript(swarm, "planner-1"), /second/);
        swarm.close();
    });

    test("a hired agent that throws is recorded and its parent is told", async () => {
        const plannerScript: ScriptedTurn[] = [
            () => ({ toolCalls: [{ name: "agent-hire", inputs: { type: "worker" } }] }),
            () => ({ toolCalls: [{ name: "agent-prompt", inputs: { agentId: "worker-1", prompt: "do the thing" } }] }),
            () => ({ content: "dispatched" }),
        ];

        const workerScript: ScriptedTurn = () => { throw new Error("worker exploded"); };

        const { swarm } = buildSwarm({ plannerScript, workerScript });
        const done = await swarm.run("build the thing");

        assert.strictEqual(done, true);
        const failures = swarm.getFailures();
        assert.strictEqual(failures.length, 1);
        assert.strictEqual(failures[0].agentId, "worker-1");
        assert.match(failures[0].error, /worker exploded/);
        assert.match(transcript(swarm, "planner-1"), /failure from worker-1/);

        swarm.close();
    });

    test("a tool's provider call is answered by the swarm, out of the swarm's own provider set", async () => {
        const describer = new ScriptedProvider("describer", () => ({ content: "a red square" }));
        const { swarm, agentTools } = buildSwarm({
            plannerScript: idle,
            workerScript: describeOnce,
            describer,
            features: { executeProviderFromMCPTool: true },
        });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await swarm.run("look at it", { agentId: "worker-1" });

        assert.strictEqual(describer.getCallCount(), 1);
        assert.match(transcript(swarm, "worker-1"), /a red square/);

        // The swarm answered out of its own provider set, but the tokens were spent
        // for one agent's tool call, so they are recorded on that agent — and the
        // swarm's totals pick them up from there rather than counting them twice.
        assert.deepStrictEqual(swarm.getFullTotalToken("image-describer"), { total: 2, inputHit: 0, inputMiss: 1, output: 1 });
        assert.deepStrictEqual(swarm.getAgent("worker-1")!.getFullTotalToken("image-describer"), { total: 2, inputHit: 0, inputMiss: 1, output: 1 });

        // ...and it rides on the tool-result message of the call that spent it,
        // written by the swarm rather than taken from what the tool returned.
        const toolMessage = swarm.getAgent("worker-1")!.getCurrentAgentStates().messagesCompact
            .find(m => m.role === "tool" && (m.usage ?? []).some(u => u.type === "image-describer"));
        assert.ok(toolMessage, "the provider call should be recorded on the tool message that made it");
        assert.deepStrictEqual(toolMessage!.usage, [{
            type: "image-describer",
            model: "scripted-describer",
            unit: "tokens",
            inputMissTokens: 1,
            inputCacheTokens: 0,
            outputTokens: 1,
        }]);

        swarm.close();
    });

    test("any agent's tool reaches the same provider set, so nobody has to be identified", async () => {
        const describer = new ScriptedProvider("describer", () => ({ content: "a red square" }));
        const { swarm, agentTools } = buildSwarm({
            plannerScript: idle,
            workerScript: describeOnce,
            describer,
            features: { executeProviderFromMCPTool: true },
        });

        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });
        await callAs(agentTools, "planner-1", "agent-hire", { type: "worker" });

        await Promise.all([
            swarm.run("look", { agentId: "worker-1" }),
            swarm.run("look", { agentId: "worker-2" }),
        ]);

        assert.strictEqual(describer.getCallCount(), 2);
        assert.match(transcript(swarm, "worker-1"), /a red square/);
        assert.match(transcript(swarm, "worker-2"), /a red square/);
        assert.strictEqual(swarm.getFullTotalToken("image-describer").total, 4);

        swarm.close();
    });

    test("the swarm's feature flag is the whole gate, and a missing provider type says so", async () => {
        const offSwarm = buildSwarm({
            plannerScript: idle,
            workerScript: describeOnce,
            describer: new ScriptedProvider("describer", () => ({ content: "a red square" })),
        });

        await callAs(offSwarm.agentTools, "planner-1", "agent-hire", { type: "worker" });
        await offSwarm.swarm.run("look", { agentId: "worker-1" });
        // Refused by the swarm rather than by the agent — that is the whole point.
        assert.match(transcript(offSwarm.swarm, "worker-1"), /SwarmBase#executeProvider: this feature is disabled/);
        offSwarm.swarm.close();

        const noProvider = buildSwarm({
            plannerScript: idle,
            workerScript: describeOnce,
            features: { executeProviderFromMCPTool: true },
        });

        await callAs(noProvider.agentTools, "planner-1", "agent-hire", { type: "worker" });
        await noProvider.swarm.run("look", { agentId: "worker-1" });
        // The tool result reaches the model as JSON, so the type name arrives quoted-and-escaped.
        assert.match(transcript(noProvider.swarm, "worker-1"), /no provider for type \\"image-describer\\"/);
        noProvider.swarm.close();
    });

    test("a roster needs agents, and a default that exists", () => {
        assert.throws(
            () => new SwarmBase({ agents: [], default: "planner", aiProvider: new ScriptedProvider("x", idle) }),
            /`agents` must contain at least one/
        );
        assert.throws(
            () => new SwarmBase({
                agents: [new AgentDefinition({ type: "planner", description: "d", instruction: "i", tools: [] })],
                default: "missing",
                aiProvider: new ScriptedProvider("x", idle),
            }),
            /no agent type "missing"/
        );
    });

    test("one getAgentTools handle drives one swarm", () => {
        const agentTools = getAgentTools({ maxHired: 1 });
        const definition = new AgentDefinition({ type: "planner", description: "d", instruction: "i", tools: agentTools.tools });
        const props = {
            agents: [definition],
            default: "planner",
            agentTools,
            aiProvider: new ScriptedProvider("x", idle),
        };

        const first = new SwarmBase(props);
        assert.throws(() => new SwarmBase(props), /already attached to another swarm/);
        first.close();
    });
});
