export { AgentTypesTool } from "./types.js";
export { AgentHireTool } from "./hire.js";
export { AgentFireTool } from "./fire.js";
export { AgentActiveTool } from "./active.js";
export { AgentPromptTool } from "./prompt.js";
export { AgentReportParentTool } from "./report-parent.js";
export { AgentReportGroupTool } from "./report-group.js";
export { AgentToolsRegistry } from "./registry.js";
export type {
    SwarmController,
    SwarmAgentTypeInfo,
    SwarmAgentInfo,
    AgentToolsEvent,
    AgentToolsAck,
    AgentToolsListener,
} from "./registry.js";

import type MCPTool from "../../core/mcp.js";
import AgentToolsRegistry, { type AgentToolsEvent, type AgentToolsListener, type SwarmController } from "./registry.js";
import { AgentTypesTool } from "./types.js";
import { AgentHireTool } from "./hire.js";
import { AgentFireTool } from "./fire.js";
import { AgentActiveTool } from "./active.js";
import { AgentPromptTool } from "./prompt.js";
import { AgentReportParentTool } from "./report-parent.js";
import { AgentReportGroupTool } from "./report-group.js";

export interface AgentToolsOptions {
    maxHired?: number;
}

export interface AgentToolsHandle {
    readonly tools: MCPTool[];
    readonly id: string;
    getMaxHired(): number | undefined;
    /** Lets the tools read the swarm's roster. SwarmBase calls this. */
    attach(swarm: SwarmController): void;
    /** Subscribe to what the tools ask the swarm to do. SwarmBase calls this, once per event. */
    on(event: AgentToolsEvent, listener: AgentToolsListener): void;
    /** Run an agent's turn labelled with its id, so tools called during it know their caller. SwarmBase wraps every run in this. */
    runAs<T>(agentId: string, fn: () => Promise<T>): Promise<T>;
}

export const getAgentTools = (options: AgentToolsOptions = {}): AgentToolsHandle => {
    const registry = new AgentToolsRegistry(options.maxHired);

    const tools: MCPTool[] = [
        AgentTypesTool(registry),
        AgentHireTool(registry),
        AgentFireTool(registry),
        AgentActiveTool(registry),
        AgentPromptTool(registry),
        AgentReportParentTool(registry),
        AgentReportGroupTool(registry),
    ];

    return {
        tools,
        id: registry.id,
        getMaxHired: () => registry.getMaxHired(),
        attach: (swarm: SwarmController) => registry.attach(swarm),
        on: (event, listener) => { registry.on(event, listener); },
        runAs: (agentId, fn) => registry.runAs(agentId, fn),
    };
};

export default getAgentTools;
