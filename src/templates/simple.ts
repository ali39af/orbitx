import type { Message } from "../core/ai-provider.js";
import type AIProvider from "../core/ai-provider.js";
import BaseAgent from "../core/base-agent.js";
import type MCPTool from "../core/mcp.js";
import MCPClient from "../core/mcp-client.js";
import MCPConnection from "../core/mcp-connection.js";
import MCPServer from "../core/mcp-server.js";
import type Skill from "../core/skill.js";

export class SimpleAgent extends BaseAgent {
    constructor({
        aiProvider,
        instruction = "",
        safetyPolicies = "",
        tools = [],
        skills = [],
        maxMemorizeToken = 16000,
        initData = {
            compactMemory: "",
            retiredMessages: [],
            messagesCompact: [],
        },
        features
    }: {
        instruction: string;
        safetyPolicies?: string;
        tools?: MCPTool[];
        aiProvider: AIProvider;
        skills?: Skill[];
        maxMemorizeToken?: number;
        initData?: {
            compactMemory: string;
            retiredMessages: Message[];
            messagesCompact: Message[];
        };
        features?: {
            executeProviderFromMCPTool?: boolean;
        }
    }) {
        const conn = new MCPConnection();
        const mcpServer = new MCPServer(conn);
        tools.forEach(tool => {
            mcpServer.registerTool(tool);
        });
        [...new Set(skills.flatMap(s => s.getSkill().tools))].filter(t => !tools.includes(t)).forEach(tool => {
            mcpServer.registerTool(tool);
            tools.push(tool);
        });

        const mcpClient = new MCPClient("DEFAULT_ENV", conn);
        super({
            aiProvider,
            instruction,
            safetyPolicies,
            mcpClient,
            allowedTools: tools,
            skills,
            maxMemorizeToken,
            initData,
            features,
        });
    }
}

export default SimpleAgent;