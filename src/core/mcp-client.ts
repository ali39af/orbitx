import type MCPTool from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";
import { randomUUID } from "crypto";
import { MCP, normalizeToolOutput } from "./mcp.js";
import MCPRNG from "./mcp-rng.js";
import type MCPStorage from "./mcp-storage.js";
import MCPFSStorage from "./mcp-fs-storage.js";
import MCPFilter from "./mcp-filter.js";

export class MCPClient extends MCP {
    #connections;
    #storage;
    #rng;
    #mcpFilter;
    #tools: MCPTool<any>[] = [];
    #envID;
    constructor(envID: string, connection: MCPConnection | MCPConnection[], storage: MCPStorage = new MCPFSStorage(), rng?: MCPRNG, mcpFilter?: MCPFilter) {
        super();
        this.#storage = storage;
        if (!rng)
            rng = new MCPRNG(storage);
        if (!mcpFilter)
            mcpFilter = new MCPFilter([
                // /\b(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)\d{1,3}\.\d{1,3}\b/g // Prevent any local ip leakage by default you can pass empty MCPFilter to disable it 
                // we add some default security roles after this feature become stable
            ]);
        this.#mcpFilter = mcpFilter;
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
                        conn.off("client_read", onRead);
                        resolve(data.tools || []);
                    }
                };

                conn.on("client_read", onRead);
                conn.emit("write_to_server", {
                    pid,
                    topic: "getTools"
                });

                setTimeout(() => {
                    if (!resolved) {
                        conn.off("client_read", onRead);
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

    async callTool(toolName: string, inputs: Record<string, any>) {
        const clientTool = this.#tools.find(t => t.getOptions().name == toolName);
        if (clientTool) {
            const raw = await clientTool.getOptions().execute(this.#envID, inputs, clientTool.getMCP(), clientTool.getOptions().customClass);
            return this.#mcpFilter.filter(normalizeToolOutput(raw));
        } else {
            const raw = await new Promise<any>((resolve) => {
                let resolvedResult = false;
                this.#connections.map(conn => {
                    const pid = randomUUID();

                    const onRead = (data: any) => {
                        if (data.topic === "toolCallCallback" && data.pid === pid) {
                            conn.off("client_read", onRead);
                            if (!resolvedResult) {
                                resolve(data.output || {});
                                resolvedResult = true;
                            }
                        }
                    };

                    conn.on("client_read", onRead);
                    conn.emit("write_to_server", {
                        pid,
                        topic: "toolCall",
                        tool: toolName,
                        envID: this.#envID,
                        inputs
                    });
                });
            });
            return this.#mcpFilter.filter(normalizeToolOutput(raw));
        }
    }

    registerTool(tool: MCPTool<any>) {
        tool.setMCP(this);
        this.#tools.push(tool);
    }
}

export default MCPClient;