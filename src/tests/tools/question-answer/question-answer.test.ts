import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { QuestionAnswerTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("question-answer/question-answer", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;

    before(async () => {
        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(QuestionAnswerTool());
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
});
