import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AgentDefinition, applyTextOverride, selectTools, Skill, MCPTool, GetCurrentTimeTool, DelayTool, FsReadFileTool, FsWriteFileTool } from "../../index.js";
import { ScriptedProvider } from "./scripted-provider.js";

const pool = () => [GetCurrentTimeTool(), DelayTool(), FsReadFileTool(), FsWriteFileTool()];

const definition = (tools: MCPTool[], extra: Partial<ConstructorParameters<typeof AgentDefinition>[0]> = {}) =>
    new AgentDefinition({
        type: "worker",
        description: "does work",
        instruction: "BASE INSTRUCTION",
        safetyPolicies: "BASE POLICY",
        tools,
        ...extra,
    });

describe("core/agent-definition", () => {
    test("applyTextOverride: undefined keeps the base, a bare string replaces it", () => {
        assert.strictEqual(applyTextOverride("base"), "base");
        assert.strictEqual(applyTextOverride("base", "new"), "new");
        assert.strictEqual(applyTextOverride("base", { replace: "new" }), "new");
    });

    test("applyTextOverride: append and prepend keep the base text", () => {
        assert.strictEqual(applyTextOverride("base", { append: "more" }), "base\n\nmore");
        assert.strictEqual(applyTextOverride("base", { prepend: "first" }), "first\n\nbase");
    });

    test("applyTextOverride: an empty base doesn't leave stray blank lines", () => {
        assert.strictEqual(applyTextOverride("", { append: "only" }), "only");
        assert.strictEqual(applyTextOverride("", { prepend: "only" }), "only");
    });

    test("selectTools: picks by exact name, in the order asked for", () => {
        const picked = selectTools(pool(), ["fs-read-file", "get-current-time"]);
        assert.deepStrictEqual(picked.map(t => t.getOptions().name), ["fs-read-file", "get-current-time"]);
    });

    test("selectTools: a trailing * matches by prefix, and duplicates are dropped", () => {
        const picked = selectTools(pool(), ["fs-*", "fs-read-file"]);
        assert.deepStrictEqual(picked.map(t => t.getOptions().name), ["fs-read-file", "fs-write-file"]);
    });

    test("selectTools: a name the app didn't construct is skipped, not an error", () => {
        const picked = selectTools(pool(), ["fs-read-file", "browser-navigate"]);
        assert.deepStrictEqual(picked.map(t => t.getOptions().name), ["fs-read-file"]);
    });

    test("with(): returns a new definition and leaves the original untouched", () => {
        const original = definition(pool());
        const derived = original.with({ instruction: { append: "EXTRA" }, safetyPolicies: "REPLACED" });

        assert.notStrictEqual(original, derived);
        assert.strictEqual(original.getDefinition().instruction, "BASE INSTRUCTION");
        assert.strictEqual(original.getDefinition().safetyPolicies, "BASE POLICY");
        assert.strictEqual(derived.getDefinition().instruction, "BASE INSTRUCTION\n\nEXTRA");
        assert.strictEqual(derived.getDefinition().safetyPolicies, "REPLACED");
    });

    test("with(): appends stack in call order, so swarm-wide lands before per-type", () => {
        const derived = definition(pool())
            .with({ instruction: { append: "SWARM WIDE" } })
            .with({ instruction: { append: "PER TYPE" } });

        assert.strictEqual(derived.getDefinition().instruction, "BASE INSTRUCTION\n\nSWARM WIDE\n\nPER TYPE");
    });

    test("with(): extraTools are appended and deduped", () => {
        const tools = pool();
        const derived = definition([tools[0]]).with({ extraTools: [tools[1], tools[0]] });

        assert.deepStrictEqual(derived.getDefinition().tools.map(t => t.getOptions().name), ["get-current-time", "delay"]);
    });

    test("with(): no overrides returns the same instance", () => {
        const original = definition(pool());
        assert.strictEqual(original.with(), original);
    });

    test("getAllTools(): skill tools are merged in, without duplicating a tool already picked", () => {
        const tools = pool();
        const skill = new Skill({ name: "s", description: "d", instructions: "i", tools: [tools[0], tools[2]] });
        const built = definition([tools[0], tools[1]], { skills: [skill] });

        assert.deepStrictEqual(
            built.getAllTools().map(t => t.getOptions().name),
            ["get-current-time", "delay", "fs-read-file"]
        );
    });

    test("buildProps(): the swarm's runtime fills what the definition left open", () => {
        const provider = new ScriptedProvider("p", () => ({ content: "hi" }));
        const props = definition(pool()).buildProps({
            aiProvider: provider,
            mcpClient: {} as any,
            maxMemorizeToken: 4242,
            features: { executeProviderFromMCPTool: true },
        });

        assert.strictEqual(props.aiProvider, provider);
        assert.strictEqual(props.maxMemorizeToken, 4242);
        assert.deepStrictEqual(props.features, { executeProviderFromMCPTool: true });
        assert.strictEqual(props.instruction, "BASE INSTRUCTION");
        assert.strictEqual(props.initData, undefined);
    });

    test("buildProps(): a definition's own provider and limits win over the swarm's", () => {
        const swarmProvider = new ScriptedProvider("swarm", () => ({ content: "hi" }));
        const ownProvider = new ScriptedProvider("own", () => ({ content: "hi" }));
        const props = definition(pool(), { aiProvider: ownProvider, maxMemorizeToken: 10 }).buildProps({
            aiProvider: swarmProvider,
            mcpClient: {} as any,
            maxMemorizeToken: 4242,
        });

        assert.strictEqual(props.aiProvider, ownProvider);
        assert.strictEqual(props.maxMemorizeToken, 10);
    });

    test("a definition without a type is rejected", () => {
        assert.throws(
            () => new AgentDefinition({ type: "", description: "d", instruction: "i", tools: [] }),
            /`type` is required/
        );
    });
});
