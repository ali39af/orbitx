import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ReadImageTool, MCPClient, MCPConnection, MCPServer } from "../../../index.js";

describe("utils/read-image", () => {
    let mcpConnection: MCPConnection | undefined;
    let mcpClient: MCPClient;
    let mcpServer: MCPServer;
    let tmpDir: string;
    let executeProviderCalls: { toolCallId: string; type: string; input: Record<string, any> }[];

    // smallest possible valid PNG (1x1 transparent pixel)
    const PNG_BASE64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), "orbitx-read-image-"));
        writeFileSync(join(tmpDir, "pixel.png"), Buffer.from(PNG_BASE64, "base64"));
        writeFileSync(join(tmpDir, "not-an-image.txt"), "hello");

        mcpConnection = new MCPConnection();
        mcpClient = new MCPClient("1234", mcpConnection);
        mcpServer = new MCPServer(mcpConnection);
        mcpServer.registerTool(ReadImageTool());

        executeProviderCalls = [];
        mcpClient.setExecuteProviderHandler(async (toolCallId, type, input) => {
            executeProviderCalls.push({ toolCallId, type, input });
            const instructionPart = input.parts?.find((p: any) => p.type === "text");
            return { output: { content: instructionPart?.text ?? "" } };
        });
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test("ReadImageTool: sends the image bytes to the image-describer provider and returns its description", async () => {
        executeProviderCalls.length = 0;
        const path = join(tmpDir, "pixel.png");
        const result = await mcpClient.callTool("read-image", { path }, "tc-1");

        assert.strictEqual(executeProviderCalls.length, 1);
        const { type, input } = executeProviderCalls[0];
        assert.strictEqual(type, "image-describer");

        const imagePart = input.parts.find((p: any) => p.type === "image");
        assert.ok(imagePart, "provider input should include an image part");
        assert.strictEqual(imagePart.mimeType, "image/png");
        assert.strictEqual(typeof imagePart.image, "string");
        assert.ok(imagePart.image.length > 0, "image should not be empty");

        assert.strictEqual(typeof result.output.description, "string");
        assert.ok(result.output.description.length > 0, "description should not be empty");
    });

    test("ReadImageTool: includes focusHint in the instruction sent to the provider only when provided", async () => {
        executeProviderCalls.length = 0;
        const path = join(tmpDir, "pixel.png");

        const withHint = await mcpClient.callTool("read-image", { path, focusHint: "check the color" }, "tc-2");
        assert.match(withHint.output.description, /check the color/);

        const withoutHint = await mcpClient.callTool("read-image", { path }, "tc-3");
        assert.doesNotMatch(withoutHint.output.description, /check the color/);
    });

    test("ReadImageTool: a missing file surfaces a descriptive error instead of throwing raw ENOENT", async () => {
        executeProviderCalls.length = 0;
        const path = join(tmpDir, "does-not-exist.png");
        const result = await mcpClient.callTool("read-image", { path }, "tc-4");

        assert.ok(result.output.error, "output should contain an error field");
        assert.match(result.output.error, /no file found at/);
        assert.strictEqual(executeProviderCalls.length, 0, "provider should never be called for a file that doesn't exist");
    });
});
