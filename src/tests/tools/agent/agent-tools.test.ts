import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getAgentTools } from "../../../index.js";
import type { AgentToolsEvent, AgentToolsHandle, MCPTool, SwarmAgentInfo, SwarmController } from "../../../index.js";

/** The read-only half of a swarm: the roster the tools consult before deciding anything. */
class StubSwarm implements SwarmController {
    agents: SwarmAgentInfo[] = [
        { agentId: "planner-1", type: "planner", groups: [], active: true, busy: false, awaitingReport: false },
        { agentId: "worker-1", type: "worker", parentId: "planner-1", groups: ["api"], active: true, busy: false, awaitingReport: false },
        { agentId: "worker-2", type: "worker", parentId: "other-1", groups: ["api"], active: true, busy: true, awaitingReport: true },
    ];

    listTypes() {
        return [{ type: "worker", description: "does work", rating: { work: 10 }, active: 2 }];
    }

    listAgents() {
        return this.agents;
    }

    getAgentInfo(agentId: string) {
        return this.agents.find(a => a.agentId === agentId);
    }

    isEntrypoint(agentId: string) {
        return agentId === "planner-1";
    }
}

const EVENTS: AgentToolsEvent[] = ["agent-hire", "agent-fire", "agent-prompt", "agent-report-parent", "agent-report-group"];

const toolNamed = (handle: AgentToolsHandle, name: string): MCPTool => {
    const tool = handle.tools.find(t => t.getOptions().name === name);
    assert.ok(tool, `no tool named ${name}`);
    return tool;
};

/** Exactly how an agent reaches a tool: inside its own labelled turn. */
const run = (handle: AgentToolsHandle, name: string, inputs: Record<string, any> = {}, agentId = "planner-1") =>
    handle.runAs(agentId, () => toolNamed(handle, name).getOptions().execute("ENV", inputs));

/** A swarm that records every request the tools make and acks it the way SwarmBase would. */
function attached(maxHired?: number) {
    const handle = getAgentTools(maxHired === undefined ? {} : { maxHired });
    const swarm = new StubSwarm();
    handle.attach(swarm);

    const asked: { event: AgentToolsEvent; agentId: string; payload: any }[] = [];

    for (const event of EVENTS) {
        handle.on(event, (agentId, payload, done) => {
            asked.push({ event, agentId, payload });

            if (event === "agent-hire") {
                const info: SwarmAgentInfo = {
                    agentId: "worker-3",
                    type: payload.type,
                    parentId: agentId,
                    groups: payload.group ? [payload.group] : [],
                    active: true,
                    busy: false,
                    awaitingReport: false,
                };
                swarm.agents.push(info);
                done(null, info);
                return;
            }

            if (event === "agent-fire") {
                const target = swarm.getAgentInfo(payload.agentId);
                if (target) target.active = false;
            }

            done();
        });
    }

    return { handle, swarm, asked };
}

describe("tools/agent", () => {
    test("getAgentTools builds the whole management set, once", () => {
        const handle = getAgentTools({ maxHired: 5 });

        assert.deepStrictEqual(
            handle.tools.map(t => t.getOptions().name),
            ["agent-types", "agent-hire", "agent-fire", "agent-active", "agent-prompt", "agent-report-parent", "agent-report-group"]
        );
        assert.strictEqual(handle.getMaxHired(), 5);
        assert.ok(handle.id.length > 0);
        assert.notStrictEqual(getAgentTools().id, handle.id);
    });

    test("the hire cap is surfaced in agent-hire's own description, so the model sees it", () => {
        const capped = getAgentTools({ maxHired: 2 });
        const uncapped = getAgentTools();

        assert.match(toolNamed(capped, "agent-hire").getOptions().description, /At most 2 agents may be hired/);
        assert.doesNotMatch(toolNamed(uncapped, "agent-hire").getOptions().description, /At most/);
    });

    test("only agent-report-parent ends the reporting agent's turn", () => {
        const handle = getAgentTools();

        assert.strictEqual(toolNamed(handle, "agent-report-parent").getOptions().stopIterationAfterUsingThisTool, true);
        assert.strictEqual(toolNamed(handle, "agent-report-group").getOptions().stopIterationAfterUsingThisTool, false);
        assert.strictEqual(toolNamed(handle, "agent-prompt").getOptions().stopIterationAfterUsingThisTool, false);
    });

    test("maxHired must be a positive integer", () => {
        assert.throws(() => getAgentTools({ maxHired: 0 }), /maxHired must be a positive integer/);
        assert.throws(() => getAgentTools({ maxHired: 1.5 }), /maxHired must be a positive integer/);
    });

    test("without a swarm the tools say so instead of failing obscurely", async () => {
        const handle = getAgentTools();

        await assert.rejects(() => run(handle, "agent-types"), /no swarm is attached/);
        await assert.rejects(() => run(handle, "agent-hire", { type: "worker" }), /no swarm is attached/);
        await assert.rejects(() => run(handle, "agent-report-parent", { report: "x" }), /no swarm is attached/);
    });

    test("called outside an agent's turn, a tool refuses rather than guessing who called it", async () => {
        const { handle } = attached();
        const execute = toolNamed(handle, "agent-hire").getOptions().execute;

        await assert.rejects(() => execute("ENV", { type: "worker" }), /could not tell which agent/);
    });

    test("a swarm that reads the roster but never listens still fails legibly", async () => {
        const handle = getAgentTools();
        handle.attach(new StubSwarm());

        await assert.rejects(
            () => run(handle, "agent-prompt", { agentId: "worker-1", prompt: "x" }),
            /no swarm is listening for "agent-prompt"/
        );
    });

    test("a handle cannot be shared between two swarms", () => {
        const { handle } = attached();
        assert.throws(() => handle.attach(new StubSwarm()), /already attached to another swarm/);
    });

    test("agent-types reports the roster and what's left of the shared cap", async () => {
        const { handle } = attached(5);
        const result = await run(handle, "agent-types");

        assert.deepStrictEqual(result.types, [{ type: "worker", description: "does work", rating: { work: 10 }, active: 2 }]);
        // The entrypoint agent is in the roster but holds no slot.
        assert.strictEqual(result.hired, 2);
        assert.strictEqual(result.maxHired, 5);
        assert.strictEqual(result.remaining, 3);
    });

    test("agent-types reports no cap as null rather than a number", async () => {
        const { handle } = attached();
        const result = await run(handle, "agent-types");

        assert.strictEqual(result.maxHired, null);
        assert.strictEqual(result.remaining, null);
    });

    test("agent-hire asks the swarm as the calling agent, and passes type, group and briefing on", async () => {
        const { handle, asked } = attached(5);
        const result = await run(handle, "agent-hire", { type: "worker", group: "api", briefing: "uses Postgres" });

        assert.deepStrictEqual(asked.at(-1), {
            event: "agent-hire",
            agentId: "planner-1",
            payload: { type: "worker", group: "api", briefing: "uses Postgres" },
        });
        assert.strictEqual(result.agentId, "worker-3");
        assert.strictEqual(result.remaining, 2);
    });

    test("a swarm that refuses the request fails the tool call with its reason", async () => {
        const handle = getAgentTools();
        handle.attach(new StubSwarm());
        handle.on("agent-hire", (_agentId, _payload, done) => done(new Error(`no agent type "designer" in this swarm`)));

        await assert.rejects(() => run(handle, "agent-hire", { type: "designer" }), /no agent type "designer"/);
    });

    test("agent-hire stops at the shared cap without asking the swarm", async () => {
        const { handle, asked } = attached(2);

        await assert.rejects(() => run(handle, "agent-hire", { type: "worker" }), /shared limit of 2 hired agent/);
        assert.deepStrictEqual(asked, []);
    });

    test("agent-hire validates its inputs before reaching the swarm", async () => {
        const { handle, asked } = attached();

        await assert.rejects(() => run(handle, "agent-hire", {}), /type must be a non-empty string/);
        await assert.rejects(() => run(handle, "agent-hire", { type: "worker", group: 5 }), /group must be a string/);
        await assert.rejects(() => run(handle, "agent-hire", { type: "worker", briefing: 5 }), /briefing must be a string/);
        assert.deepStrictEqual(asked, []);
    });

    test("agent-active lists the hired agents and marks which belong to the caller", async () => {
        const { handle } = attached();
        const result = await run(handle, "agent-active");

        // The entrypoint agent is never listed — it is nobody's hire.
        assert.deepStrictEqual(result.agents.map((a: any) => [a.agentId, a.yours]), [["worker-1", true], ["worker-2", false]]);
    });

    test("agent-active can filter by group", async () => {
        const { handle, swarm } = attached();
        swarm.agents[2].groups = [];

        const result = await run(handle, "agent-active", { group: "api" });
        assert.deepStrictEqual(result.agents.map((a: any) => a.agentId), ["worker-1"]);
    });

    test("agent-prompt hands the task over and says so without waiting for a result", async () => {
        const { handle, asked } = attached();
        const result = await run(handle, "agent-prompt", { agentId: "worker-1", prompt: "do the thing" });

        assert.strictEqual(asked.at(-1)?.event, "agent-prompt");
        assert.deepStrictEqual(asked.at(-1)?.payload.to, ["worker-1"]);
        assert.match(asked.at(-1)!.payload.message, /^\[task from planner-1, the agent that hired you\]\ndo the thing$/);
        assert.deepStrictEqual(result, { dispatched: true, agentId: "worker-1" });
    });

    test("agent-prompt and agent-fire only work on agents the caller hired", async () => {
        const { handle, asked } = attached();

        await assert.rejects(() => run(handle, "agent-prompt", { agentId: "worker-2", prompt: "x" }), /only other-1/);
        await assert.rejects(() => run(handle, "agent-fire", { agentId: "worker-2" }), /only other-1/);
        await assert.rejects(() => run(handle, "agent-fire", { agentId: "planner-1" }), /entrypoint agent cannot be fired/);
        await assert.rejects(() => run(handle, "agent-prompt", { agentId: "ghost-1", prompt: "x" }), /no agent "ghost-1"/);
        assert.deepStrictEqual(asked, []);
    });

    test("agent-prompt validates its inputs", async () => {
        const { handle } = attached();

        await assert.rejects(() => run(handle, "agent-prompt", { prompt: "x" }), /agentId must be a non-empty string/);
        await assert.rejects(() => run(handle, "agent-prompt", { agentId: "worker-1" }), /prompt must be a non-empty string/);
    });

    test("agent-fire asks the swarm to drop the agent and reports the freed slot", async () => {
        const { handle, asked } = attached(5);
        const result = await run(handle, "agent-fire", { agentId: "worker-1" });

        assert.deepStrictEqual(asked.at(-1), { event: "agent-fire", agentId: "planner-1", payload: { agentId: "worker-1" } });
        assert.strictEqual(result.fired, true);
        assert.strictEqual(result.remaining, 4);
        await assert.rejects(() => run(handle, "agent-fire", { agentId: "worker-1" }), /already fired/);
        await assert.rejects(() => run(handle, "agent-fire", {}), /agentId must be a non-empty string/);
    });

    test("agent-report-parent addresses the report to the caller's parent", async () => {
        const { handle, asked } = attached();
        const result = await run(handle, "agent-report-parent", { report: "WORK DONE" }, "worker-1");

        assert.strictEqual(asked.at(-1)?.event, "agent-report-parent");
        assert.deepStrictEqual(asked.at(-1)?.payload.to, ["planner-1"]);
        assert.match(asked.at(-1)!.payload.message, /^\[report from worker-1 \(worker\), an agent you hired\]\nWORK DONE$/);
        assert.deepStrictEqual(result, { delivered: true, to: "planner-1" });
        await assert.rejects(() => run(handle, "agent-report-parent", {}, "worker-1"), /report must be a non-empty string/);
    });

    test("agent-report-parent has nothing to do for the entrypoint agent", async () => {
        const { handle } = attached();
        await assert.rejects(() => run(handle, "agent-report-parent", { report: "x" }), /no parent/);
    });

    test("agent-report-group addresses the caller's peers and not the caller itself", async () => {
        const { handle, asked } = attached();
        const result = await run(handle, "agent-report-group", { message: "SHARED NOTE" }, "worker-1");

        assert.deepStrictEqual(asked.at(-1)?.payload.to, ["worker-2"]);
        assert.match(asked.at(-1)!.payload.message, /^\[group "api" message from worker-1 \(worker\)\]\nSHARED NOTE$/);
        assert.deepStrictEqual(result, { delivered: true, group: "api", to: ["worker-2"] });
        await assert.rejects(() => run(handle, "agent-report-group", { message: "x", group: 5 }, "worker-1"), /group must be a string/);
        await assert.rejects(() => run(handle, "agent-report-group", { message: "x", group: "ui" }, "worker-1"), /not in group "ui"/);
    });

    test("agent-report-group needs a group to send to", async () => {
        const { handle, swarm } = attached();

        await assert.rejects(() => run(handle, "agent-report-group", { message: "x" }), /not in any group/);

        swarm.agents[1].groups = ["api", "ui"];
        await assert.rejects(() => run(handle, "agent-report-group", { message: "x" }, "worker-1"), /more than one group.*api, ui/);
    });

    test("parallel turns don't mix up who is calling", async () => {
        const { handle, swarm, asked } = attached();
        swarm.agents.push({ agentId: "worker-9", type: "worker", parentId: "worker-1", groups: [], active: true, busy: false, awaitingReport: false });

        await Promise.all([
            run(handle, "agent-report-parent", { report: "from one" }, "worker-1"),
            run(handle, "agent-report-parent", { report: "from two" }, "worker-9"),
        ]);

        assert.deepStrictEqual(
            asked.map(a => [a.agentId, a.payload.to[0]]).sort(),
            [["worker-1", "planner-1"], ["worker-9", "worker-1"]]
        );
    });
});
