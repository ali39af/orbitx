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
    });

    after(async () => {
        mcpConnection?.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    // Like BrowserScreenshotTool, the image content only gets interpreted
    // further downstream by an AI vision model (see
    // BaseAgent#resolveToolOutputForModel); none of that runs here, so this only
    // confirms the tool itself returns an image output, not anything about what
    // the image shows.
    test("ReadImageTool: reads a png file and returns an image tool-output with the right mimeType", async () => {
        const path = join(tmpDir, "pixel.png");
        const result = await mcpClient.callTool("read-image", { path });

        assert.strictEqual(result.type, "image");
        assert.strictEqual(result.output.mimeType, "image/png");
        assert.strictEqual(typeof result.output.image, "string");
        assert.ok(result.output.image.length > 0, "image should not be empty");
    });

    test("ReadImageTool: includes focusHint in the output only when provided", async () => {
        const path = join(tmpDir, "pixel.png");

        const withHint = await mcpClient.callTool("read-image", { path, focusHint: "check the color" });
        assert.strictEqual(withHint.output.focusHint, "check the color");

        const withoutHint = await mcpClient.callTool("read-image", { path });
        assert.strictEqual("focusHint" in withoutHint.output, false);
    });

    test("ReadImageTool: a missing file surfaces a descriptive error instead of throwing raw ENOENT", async () => {
        const path = join(tmpDir, "does-not-exist.png");
        const result = await mcpClient.callTool("read-image", { path });

        assert.ok(result.output.error, "output should contain an error field");
        assert.match(result.output.error, /no file found at/);
    });
});
