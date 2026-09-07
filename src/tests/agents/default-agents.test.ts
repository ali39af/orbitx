import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DefaultAgents,
    PlannerAgent,
    ReasonerAgent,
    BackendAgent,
    FrontendAgent,
    TestAgent,
    ResearchAgent,
    getAgentTools,
    FsTools,
    BashTools,
    BrowserTools,
    TodoTools,
    UtilTools,
    QuestionAnswerTools,
} from "../../index.js";
import type { MCPTool } from "../../index.js";

const pool = (): MCPTool[] => [
    ...getAgentTools({ maxHired: 3 }).tools,
    ...FsTools(),
    ...BashTools(),
    ...BrowserTools(),
    ...TodoTools(),
    ...UtilTools(),
    ...QuestionAnswerTools(),
];

const toolNames = (factory: typeof PlannerAgent) =>
    factory({ tools: pool() }).getDefinition().tools.map(t => t.getOptions().name);

describe("agents/default", () => {
    test("DefaultAgents is a usable roster covering the whole build pipeline", () => {
        const tools = pool();
        const types = DefaultAgents().map(factory => factory({ tools }).getType());

        assert.deepStrictEqual(types, ["planner", "reasoner", "backend", "frontend", "tester", "research"]);
    });

    test("every default definition has a description a hiring model can judge from", () => {
        const tools = pool();
        for (const factory of DefaultAgents()) {
            const { description, instruction, rating } = factory({ tools }).getDefinition();
            assert.ok(description.length > 40, `${factory.name} description is too thin to hire from`);
            assert.ok(instruction.length > 100, `${factory.name} instruction is too thin`);
            assert.ok(rating && Object.keys(rating).length > 0, `${factory.name} has no ratings`);
        }
    });

    test("the planner gets the hiring tools and no way to edit the project itself", () => {
        const names = toolNames(PlannerAgent);

        for (const hiring of ["agent-types", "agent-hire", "agent-fire", "agent-active", "agent-prompt"]) {
            assert.ok(names.includes(hiring), `planner is missing ${hiring}`);
        }
        assert.ok(names.includes("fs-read-file"), "planner should still be able to read the project");
        assert.ok(!names.includes("fs-write-file"), "a planner that can write starts doing the work itself");
        assert.ok(!names.includes("bash-run"));
        assert.ok(!names.includes("agent-report-parent"), "the entrypoint has nobody to report to");
    });

    test("workers get the reporting tools and not the hiring ones", () => {
        for (const factory of [ReasonerAgent, BackendAgent, FrontendAgent, TestAgent, ResearchAgent]) {
            const names = toolNames(factory);
            assert.ok(names.includes("agent-report-parent"), `${factory.name} cannot report back`);
            assert.ok(names.includes("agent-report-group"), `${factory.name} cannot talk to its group`);
            assert.ok(!names.includes("agent-hire"), `${factory.name} should not be hiring`);
        }
    });

    test("each worker picks the tools its own job needs", () => {
        const backend = toolNames(BackendAgent);
        assert.ok(backend.includes("fs-write-file") && backend.includes("bash-run"));
        assert.ok(!backend.includes("browser-navigate"), "backend has no reason to drive a browser");

        const frontend = toolNames(FrontendAgent);
        assert.ok(frontend.includes("fs-write-file") && frontend.includes("browser-navigate"));

        const research = toolNames(ResearchAgent);
        assert.ok(research.includes("browser-navigate") && research.includes("fs-read-file"));
        assert.ok(!research.includes("fs-write-file"), "a read-only agent must not be able to write");
        assert.ok(!research.includes("bash-run"), "a read-only agent must not be able to run commands");

        const tester = toolNames(TestAgent);
        assert.ok(tester.includes("bash-run"), "the tester has to be able to build and run what it checks");
        assert.ok(tester.includes("browser-navigate"), "the tester has to drive the real UI");
        assert.ok(tester.includes("fs-write-file"), "the tester writes test files, though never production code");
    });

    test("the reasoner can measure and pace its own five minutes, and cannot build anything", () => {
        const names = toolNames(ReasonerAgent);

        assert.ok(names.includes("get-current-time"), "the panel's clock is measured, not estimated");
        assert.ok(!names.includes("delay"), "the five minutes are filled with argument — there is nothing to sleep on");
        assert.ok(names.includes("question-answer"), "the panel interrogates the user before it reasons");
        assert.ok(names.includes("fs-read-file"), "it should argue about the real project");
        assert.ok(!names.includes("fs-write-file"), "the reasoner thinks, it does not build");
        assert.ok(!names.includes("bash-run"));
    });

    test("the pipeline the planner describes matches the roster it can hire from", () => {
        const tools = pool();
        const instruction = PlannerAgent({ tools }).getDefinition().instruction;
        const types = DefaultAgents().map(factory => factory({ tools }).getType());

        for (const type of types.filter(t => t !== "planner" && t !== "research")) {
            assert.match(instruction, new RegExp(type), `the planner never mentions the ${type} it can hire`);
        }
    });

    test("frontend agents are told how to share a project without overwriting each other", () => {
        const instruction = FrontendAgent({ tools: pool() }).getDefinition().instruction;

        assert.match(instruction, /claim your files/i);
        assert.match(instruction, /never edit a file another agent has claimed/i);
        assert.match(instruction, /agree on the scaffold/i);
    });

    test("a definition only picks what the app actually constructed", () => {
        const names = BackendAgent({ tools: [...UtilTools()] }).getDefinition().tools.map(t => t.getOptions().name);

        assert.deepStrictEqual(names, ["get-current-time"]);
    });

    test("factory overrides apply on top of the shipped persona", () => {
        const definition = BackendAgent({
            tools: pool(),
            instruction: { append: "This project uses Postgres." },
            safetyPolicies: "Never touch anything outside /workspace.",
        }).getDefinition();

        assert.match(definition.instruction, /You are a backend engineer/);
        assert.match(definition.instruction, /This project uses Postgres\.$/);
        assert.strictEqual(definition.safetyPolicies, "Never touch anything outside /workspace.");
    });

    test("skills come along with the definition and bring their own tools", () => {
        const definition = BackendAgent({ tools: pool() });
        const skills = definition.getDefinition().skills ?? [];

        assert.ok(skills.length >= 3);
        assert.ok(definition.getAllTools().length >= definition.getDefinition().tools.length);
    });
});
