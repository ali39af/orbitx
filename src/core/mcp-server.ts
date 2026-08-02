import { MCP, type MCPTool } from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";
import type MCPStorage from "./mcp-storage.js";
import MCPFSStorage from "./mcp-fs-storage.js";
import MCPRNG from "./mcp-rng.js";

export class MCPServer extends MCP {
    #connection;
    #storage;
    #rng;
    #tools: MCPTool<any>[] = [];
    constructor(connection: MCPConnection, storage: MCPStorage = new MCPFSStorage(), rng?: MCPRNG) {
        super();
        this.#connection = connection;
        this.#storage = storage;
        if (!rng)
            rng = new MCPRNG(storage);
        this.#rng = rng;
        this.#connection.on("read", (data: any) => {
            const topic = data.topic;
            const pid = data.pid;
            if (topic == "getTools") {
                this.#connection.emit("write", {
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
                    tool.getOptions().execute(data.envID, data.inputs, tool.getMCP(), tool.getOptions().customClass).then((response) => {
                        this.#connection.emit("write", {
                            pid,
                            topic: "toolCallCallback",
                            output: response
                        });
                    }).catch(error => {
                        this.#connection.emit("write", {
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

    registerTool(tool: MCPTool<any>) {
        tool.setMCP(this);
        this.#tools.push(tool);
    }
}

export default MCPServer;