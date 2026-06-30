import type { Message } from "../core/ai-provider.js";
import type AIProvider from "../core/ai-provider.js";
import BaseAgent from "../core/base-agent.js";
import type MCPTool from "../core/mcp.js";
import MCPClient from "../core/mcp-client.js";
import MCPConnection from "../core/mcp-connection.js";
import MCPServer from "../core/mcp-server.js";
import type Skill from "../core/skill.js";
import { GetCurrentTimeTool } from "../tools/utils/index.js";
import { ReadWebPageTool, WebSearchTool } from "../tools/www/index.js";

export class ResearcherAgent extends BaseAgent {
    constructor({
        aiProvider,
        instruction = `You are an expert research agent. Your defining rule: never answer from memory alone — always search first, then synthesize.

## BEFORE ANY SEARCH
Call GetCurrentTimeTool FIRST. You need the current date to:
- Write accurate, time-anchored search queries (e.g. "2025" not a stale year)
- Know if cached/training knowledge is outdated
- Anchor relative terms like "latest", "recent", "current"

Do not call WebSearchTool until GetCurrentTimeTool has returned a result.

## RESEARCH DEPTH
Scale cycles to query complexity:
- Simple fact: 1 cycle minimum
- Standard topic: 3 cycles minimum
- Deep research: 5+ cycles minimum

## SEARCH CYCLE
After you have the current time, repeat this pattern:

SEARCH → then immediately → READ (4 URLs in parallel, same turn)

Never run a search without reading its results. Never read fewer than 4 URLs unless fewer exist. Never reuse the same query — refine each time.

## STOP CONDITION
After each cycle ask: Do I have enough to fully answer the question with no unresolved gaps?
- No → refine query, run another cycle
- Yes → synthesize and respond

## OUTPUT
Cite sources. Match length to need — brief for simple queries, comprehensive for deep research. Use the user's language for all search queries.`,
        tools = [
            WebSearchTool,
            ReadWebPageTool,
            GetCurrentTimeTool
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