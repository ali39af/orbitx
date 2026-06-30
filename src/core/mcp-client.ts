import type MCPTool from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";
import { randomUUID } from "crypto";

export class MCPClient {
    #connections;
    #tools: MCPTool[] = [];
    #envID;
    constructor(envID: string, connection: MCPConnection | MCPConnection[]) {
        this.#connections = Array.isArray(connection) ? connection : [connection];
        this.#envID = envID;
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
        return [...this.#tools.map(t => ({
            name: t.getOptions().name,
            description: t.getOptions().description,
            inputs: t.getOptions().inputs
        })), ...connectionsTools];
    }

    async callTool(toolName: string, inputs: Record<string, any>) {
        const clientTool = this.#tools.find(t => t.getOptions().name == toolName);
        if (clientTool) {
            return JSON.stringify(await clientTool.getOptions().execute(this.#envID, inputs));
        } else {
            return JSON.stringify(await new Promise<any>((resolve) => {
                let resolvedResult = false;
                this.#connections.map(conn => {
                    const pid = randomUUID();
                    let resolved = false;

                    const onRead = (data: any) => {
                        if (data.topic === "toolCallCallback" && data.pid === pid) {
                            resolved = true;
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

                    setTimeout(() => {
                        if (!resolved) {
                            conn.off("read", onRead);
                        }
                        if (!resolvedResult) {
                            resolve({ error: "The tool call exceeded the 300second timeout limit." });
                            resolvedResult = true;
                        }
                    }, 300000);
                });
            }));
        }
    }

    registerTool(tool: MCPTool) {
        this.#tools.push(tool);
    }
}

export default MCPClient;