import type { Message } from "../core/ai-provider";
import type AIProvider from "../core/ai-provider";
import BaseAgent from "../core/base-agent";
import type MCPTool from "../core/mcp";
import MCPClient from "../core/mcp-client";
import MCPConnection from "../core/mcp-connection";
import MCPServer from "../core/mcp-server";
import type Skill from "../core/skill";

export class SimpleAgent extends BaseAgent {
    constructor({
        aiProvider,
        instruction = "",
        tools = [],
        skills = [],
        maxMemorizeToken = 16000,
        initData = {
            memory: "",
            messagesFull: [],
            fullInputMissTokens: 0,
            fullInputHitTokens: 0,
            fullOutputTokens: 0,
            messagesCompact: [],
            currentInputMissTokens: 0,
            currentInputHitTokens: 0,
            currentOutputTokens: 0,
        }
    }: {
        instruction: string;
        tools: MCPTool[];
        aiProvider: AIProvider;
        skills?: Skill[];
        maxMemorizeToken?: number;
        initData?: {
            memory: string;
            messagesFull: Message[];
            fullInputMissTokens: number;
            fullInputHitTokens: number;
            fullOutputTokens: number;
            messagesCompact: Message[];
            currentInputMissTokens: number;
            currentInputHitTokens: number;
            currentOutputTokens: number;
        }
    }) {
        const conn = new MCPConnection();
        const mcpServer = new MCPServer(conn);
        tools.forEach(tool => {
            mcpServer.registerTool(tool);
        });
        const mcpClient = new MCPClient("DEFAULT_ENV", conn);
        super({
            aiProvider,
            instruction,
            mcpClient,
            allowedTools: tools,
            skills,
            maxMemorizeToken,
            initData,
        });
    }
}

export default SimpleAgent;