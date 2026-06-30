import type MCPTool from "./mcp.js";
import type MCPConnection from "./mcp-connection.js";

export class MCPServer {
    #connection;
    #tools: MCPTool[] = [];
    constructor(connection: MCPConnection) {
        this.#connection = connection;
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
                    tool.getOptions().execute(data.envID, data.inputs).then((response) => {
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

    registerTool(tool: MCPTool) {
        this.#tools.push(tool);
    }
}

export default MCPServer;