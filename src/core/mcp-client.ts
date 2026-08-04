import type MCPTool from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";
import { randomUUID } from "crypto";
import { MCP, normalizeToolOutput } from "./mcp.js";
import MCPRNG from "./mcp-rng.js";
import type MCPStorage from "./mcp-storage.js";
import MCPFSStorage from "./mcp-fs-storage.js";

export class MCPClient extends MCP {
    #connections;
    #storage;
    #rng;
    #tools: MCPTool<any>[] = [];
    #envID;
    constructor(envID: string, connection: MCPConnection | MCPConnection[], storage: MCPStorage = new MCPFSStorage(), rng?: MCPRNG) {
        super();
        this.#storage = storage;
        if (!rng)
            rng = new MCPRNG(storage);
        this.#rng = rng;
        this.#connections = Array.isArray(connection) ? connection : [connection];
        this.#envID = envID;
    }

    getStorage(): MCPStorage {
        return this.#storage;
    }

    getRNG(): MCPRNG {
        return this.#rng;
    }

    async getTools() {
        const connectionPromises = this.#connections.map(conn => {
            return new Promise<{
                name: string;
                description: string;
                inputs: {
                    name: string;
                    type: "number" | "string" | "boolean" | "object" | "array";
                    description: string;
                    required?: boolean;
                    default?: any;
                }[];
            }[]>((resolve) => {
                const pid = randomUUID();
                let resolved = false;

                const onRead = (data: any) => {
                    if (data.topic === "getToolsCallback" && data.pid === pid) {
                        resolved = true;
                        conn.off("read", onRead);
                        resolve(data.tools || []);
                    }
                };

                conn.on("read", onRead);
                conn.emit("write", {
                    pid,
                    topic: "getTools"
                });

                setTimeout(() => {
                    if (!resolved) {
                        conn.off("read", onRead);
                        resolve([]);
                    }
                }, 2000);
            });
        });

        const results = await Promise.all(connectionPromises);

        const connectionsTools = results.flat();
        const clientTools = this.#tools.map(t => ({
            name: t.getOptions().name,
            description: t.getOptions().description,
            inputs: t.getOptions().inputs
        }));
        const clientToolNames = new Set(clientTools.map(ct => ct.name));
        return [...clientTools, ...connectionsTools.filter(t => !clientToolNames.has(t.name))];
    }

    /**
     * Calls a tool and returns its result normalized into the standard
     * MCPToolOutput contract ({type:"text"|"image", output:{...}}) —
     * regardless of whether the tool lives in-process or across the
     * IPC connection to a sandboxed MCPServer, and regardless of whether
     * the tool itself already returns that shape or just a plain object
     * (the legacy convention most existing tools use).
     */
    async callTool(toolName: string, inputs: Record<string, any>) {
        const clientTool = this.#tools.find(t => t.getOptions().name == toolName);
        if (clientTool) {
            const raw = await clientTool.getOptions().execute(this.#envID, inputs, clientTool.getMCP(), clientTool.getOptions().customClass);
            return normalizeToolOutput(raw);
        } else {
            const raw = await new Promise<any>((resolve) => {
                let resolvedResult = false;
                this.#connections.map(conn => {
                    const pid = randomUUID();

                    const onRead = (data: any) => {
                        if (data.topic === "toolCallCallback" && data.pid === pid) {
                            conn.off("read", onRead);
                            if (!resolvedResult) {
                                resolve(data.output || {});
                                resolvedResult = true;
                            }
                        }
                    };

                    conn.on("read", onRead);
                    conn.emit("write", {
                        pid,
                        topic: "toolCall",
                        tool: toolName,
                        envID: this.#envID,
                        inputs
                    });
                });
            });
            return normalizeToolOutput(raw);
        }
    }

    registerTool(tool: MCPTool<any>) {
        tool.setMCP(this);
        this.#tools.push(tool);
    }
}

export default MCPClient;