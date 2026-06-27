import type { Message } from "../core/ai-provider";
import type AIProvider from "../core/ai-provider";
import BaseAgent from "../core/base-agent";
import type MCPTool from "../core/mcp";
import MCPClient from "../core/mcp-client";
import MCPConnection from "../core/mcp-connection";
import MCPServer from "../core/mcp-server";
import type Skill from "../core/skill";
import { ReadWebPageTool, WebSearchTool } from "../tools/www";

export class ResearcherAgent extends BaseAgent {
    constructor({
        aiProvider,
        instruction = `you are research agent you have some rules you don't know about any true otherwise first search about it
your each topic search iteration contain two step
1. use web-search tool to get some urls from search engine
2. read 4 url with best topic near to out search query in this step you execute 4 read-web-page tool call at once
if result is resolve needs we stop otherwise do above operation more
YOU MUST DO two step before decide to response don't do web-search alone!! at less do search and read page operation 3 times to to get as much information as possible`,
        tools = [
            WebSearchTool,
            ReadWebPageTool
        ],
        skills = [],
        maxMemorizeToken = 30000,
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
        instruction?: string;
        tools?: MCPTool[];
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

export default ResearcherAgent;