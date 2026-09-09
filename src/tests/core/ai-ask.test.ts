import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AIASK } from "../../index.js";
import { ScriptedProvider } from "./scripted-provider.js";

describe("core/ai-ask", () => {
    test("run(): a valid first attempt returns immediately with valid:true, attempts:1", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { valid: true, score: 7 } }],
        }));

        const ask = new AIASK({
            instruction: "classify the input",
            aiModel: provider,
            outputStructure: [
                { name: "valid", type: "boolean", description: "whether it's valid" },
                { name: "score", type: "number", description: "confidence 0-10" },
            ],
        });

        const result = await ask.run("check this");

        assert.deepStrictEqual(result.output, { valid: true, score: 7 });
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.attempts, 1);
        assert.strictEqual(result.errors, undefined);
    });

    test("run(): a missing required field triggers a retry, and a corrected 2nd attempt succeeds", async () => {
        const provider = new ScriptedProvider("p", [
            () => ({ toolCalls: [{ name: "submit_answer", inputs: { valid: true } }] }), // 1st attempt, missing "score"
            () => ({ toolCalls: [{ name: "submit_answer", inputs: { valid: true, score: 9 } }] }), // 2nd attempt, corrected
        ]);

        const ask = new AIASK({
            instruction: "classify the input",
            aiModel: provider,
            outputStructure: [
                { name: "valid", type: "boolean", description: "whether it's valid" },
                { name: "score", type: "number", description: "confidence 0-10" },
            ],
        });

        const result = await ask.run("check this");

        assert.deepStrictEqual(result.output, { valid: true, score: 9 });
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.attempts, 2);
    });

    test("run(): a wrong-typed field is rejected as invalid", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { valid: "yes" } }], // should be boolean
        }));

        const ask = new AIASK({
            instruction: "x",
            aiModel: provider,
            outputStructure: [{ name: "valid", type: "boolean", description: "d" }],
        });

        const result = await ask.run("go");

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.attempts, 3);
        assert.match(result.errors![0]!, /should be boolean/);
    });

    test("run(): plain text instead of calling the tool counts as a failed attempt and retries", async () => {
        const provider = new ScriptedProvider("p", [
            () => ({ content: "I think it's valid" }), // no tool call at all
            () => ({ toolCalls: [{ name: "submit_answer", inputs: { valid: true } }] }),
        ]);

        const ask = new AIASK({
            instruction: "x",
            aiModel: provider,
            outputStructure: [{ name: "valid", type: "boolean", description: "d" }],
        });

        const result = await ask.run("go");

        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.attempts, 2);
    });

    test("run(): gives up after 3 attempts, returning the last best-effort output with valid:false", async () => {
        const provider = new ScriptedProvider("p", () => ({ content: "nope, just text" }));

        const ask = new AIASK({
            instruction: "x",
            aiModel: provider,
            outputStructure: [{ name: "valid", type: "boolean", description: "d" }],
        });

        const result = await ask.run("go");

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.attempts, 3);
        assert.deepStrictEqual(result.output, {});
        assert.strictEqual(result.errors!.length, 1);
        assert.strictEqual(provider.getCallCount(), 3, "one chat() call per attempt, no automatic follow-up");
    });

    test("run(): an optional field (required: false) may be omitted without failing validation", async () => {
        const provider = new ScriptedProvider("p", () => ({
            toolCalls: [{ name: "submit_answer", inputs: { valid: true } }],
        }));

        const ask = new AIASK({
            instruction: "x",
            aiModel: provider,
            outputStructure: [
                { name: "valid", type: "boolean", description: "d" },
                { name: "note", type: "string", description: "d", required: false },
            ],
        });

        const result = await ask.run("go");

        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.attempts, 1);
    });
});
