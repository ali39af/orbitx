import { MCP, type MCPTool } from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";
import type MCPStorage from "./mcp-storage.js";
import MCPFSStorage from "./mcp-fs-storage.js";
import MCPRNG from "./mcp-rng.js";
import { randomUUID } from "crypto";
import type { ProviderType } from "./ai-provider.js";

const EXECUTE_PROVIDER_TIMEOUT_MS = 120000;

export class MCPServer extends MCP {
    #connection;
    #storage;
    #rng;
    #tools: MCPTool[] = [];
    constructor(connection: MCPConnection, storage: MCPStorage = new MCPFSStorage(), rng?: MCPRNG) {
        super();
        this.#connection = connection;
        this.#storage = storage;
        if (!rng)
            rng = new MCPRNG(storage);
        this.#rng = rng;
        this.#connection.on("server_read", (data: any) => {
            const topic = data.topic;
            const pid = data.pid;
            if (topic == "getTools") {
                this.#connection.emit("write_to_client", {
                    pid,
                    topic: "getToolsCallback",
                    tools: this.#tools.map(tool => ({
                        name: tool.getOptions().name,
                        description: tool.getOptions().description,
                        inputs: tool.getOptions().inputs
                    }))
                });
            }
            if (topic == "toolCall") {
                const tool = this.#tools.find(t => t.getOptions().name == data.tool);
                if (tool) {
                    tool.getOptions().execute(data.envID, data.inputs, data.toolCallId, tool.getMCP()).then((response) => {
                        this.#connection.emit("write_to_client", {
                            pid,
                            topic: "toolCallCallback",
                            output: response
                        });
                    }).catch(error => {
                        this.#connection.emit("write_to_client", {
                            pid,
                            topic: "toolCallCallback",
                            output: { error: error.message }
                        });
                    });
                }
            }
        });
    }

    getStorage() {
        return this.#storage;
    }

    getRNG() {
        return this.#rng;
    }

    executeProvider(toolCallId: string, type: ProviderType, input: Record<string, any>): Promise<{ output: Record<string, any> }> {
        return new Promise((resolve, reject) => {
            const pid = randomUUID();
            let settled = false;

            const onRead = (data: any) => {
                if (data.topic === "executeProviderResponse" && data.pid === pid) {
                    this.#connection.off("server_read", onRead);
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (data.error) reject(new Error(data.error));
                    else resolve({ output: data.output ?? {} });
                }
            };

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.#connection.off("server_read", onRead);
                reject(new Error(`MCPServer.executeProvider: no response for type "${type}" within ${EXECUTE_PROVIDER_TIMEOUT_MS}ms.`));
            }, EXECUTE_PROVIDER_TIMEOUT_MS);

            this.#connection.on("server_read", onRead);
            this.#connection.emit("write_to_client", { pid, topic: "executeProvider", toolCallId, type, input });
        });
    }

    registerTool(tool: MCPTool) {
        tool.setMCP(this);
        this.#tools.push(tool);
    }
}

export default MCPServer;