import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { QuestionAnswerTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("question-answer/question-answer", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let events: any[];

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);

        const tool = QuestionAnswerTool();
        mcpServer.registerTool(tool);

        events = [];
        tool.getOptions().customClass?.getEvents().on("question-answer", (e) => events.push(e));
    });

    after(async () => {
        mcpConnection?.close();
    });

    test("QuestionAnswerTool: returns a success message", async () => {
        const result = await mcpClient.callTool("question-answer", {
            questions: [{ question: "Which color?", predefinedAnswer: ["red", "blue"] }],
        });

        assert.strictEqual(result.output.message, "success");
    });

    test("QuestionAnswerTool: emits a question-answer event through its interaction class", async () => {
        events.length = 0;

        await mcpClient.callTool("question-answer", { questions: [{ question: "ok?" }] });

        assert.strictEqual(events.length, 1);
        assert.deepStrictEqual(events[0], { type: "question-answer" });
    });
});
