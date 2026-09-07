import type MCPTool from "./mcp.js";
import type Skill from "./skill.js";
import type MCPClient from "./mcp-client.js";
import type { AgentProvidersInput } from "./agent-providers.js";
import type { AgentState, BaseAgentProps } from "./base-agent.js";

export type TextOverride =
    | string
    | { replace: string }
    | { append: string }
    | { prepend: string };

export function applyTextOverride(base: string, override?: TextOverride): string {
    if (override === undefined) return base;
    if (typeof override === "string") return override;
    if ("replace" in override) return override.replace;
    if ("append" in override) return base ? `${base}\n\n${override.append}` : override.append;
    if ("prepend" in override) return base ? `${override.prepend}\n\n${base}` : override.prepend;
    return base;
}

export interface AgentOverrides {
    instruction?: TextOverride;
    safetyPolicies?: TextOverride;
    aiProvider?: AgentProvidersInput;
    maxMemorizeToken?: number;
    features?: {
        executeProviderFromMCPTool?: boolean;
    };
    extraTools?: MCPTool[];
}

export interface AgentDefinitionProps {
    type: string;
    description: string;
    rating?: Record<string, number>;
    instruction: string;
    safetyPolicies?: string;
    tools: MCPTool[];
    skills?: Skill[];
    aiProvider?: AgentProvidersInput;
    maxMemorizeToken?: number;
    features?: {
        executeProviderFromMCPTool?: boolean;
    };
}

export class AgentDefinition {
    #def: AgentDefinitionProps;

    constructor(def: AgentDefinitionProps) {
        if (!def.type) {
            throw new Error("AgentDefinition: `type` is required — it's the name a hiring agent uses to hire this kind of agent.");
        }
        this.#def = { ...def, tools: [...def.tools], skills: def.skills ? [...def.skills] : [] };
    }

    getDefinition(): AgentDefinitionProps {
        return this.#def;
    }

    getType(): string {
        return this.#def.type;
    }

    with(overrides?: AgentOverrides): AgentDefinition {
        if (!overrides) return this;

        const tools = [...this.#def.tools];
        for (const tool of overrides.extraTools ?? []) {
            if (!tools.includes(tool)) tools.push(tool);
        }

        return new AgentDefinition({
            ...this.#def,
            instruction: applyTextOverride(this.#def.instruction, overrides.instruction),
            safetyPolicies: applyTextOverride(this.#def.safetyPolicies ?? "", overrides.safetyPolicies),
            aiProvider: overrides.aiProvider ?? this.#def.aiProvider,
            maxMemorizeToken: overrides.maxMemorizeToken ?? this.#def.maxMemorizeToken,
            features: overrides.features ?? this.#def.features,
            tools,
        });
    }

    getAllTools(): MCPTool[] {
        const tools = [...this.#def.tools];
        for (const tool of (this.#def.skills ?? []).flatMap(s => s.getSkill().tools)) {
            if (!tools.includes(tool)) tools.push(tool);
        }
        return tools;
    }

    buildProps(runtime: {
        aiProvider: AgentProvidersInput;
        mcpClient: MCPClient;
        initData?: AgentState;
        maxMemorizeToken?: number;
        features?: { executeProviderFromMCPTool?: boolean };
    }): BaseAgentProps {
        return {
            instruction: this.#def.instruction,
            safetyPolicies: this.#def.safetyPolicies ?? "",
            allowedTools: this.getAllTools(),
            skills: this.#def.skills ?? [],
            aiProvider: this.#def.aiProvider ?? runtime.aiProvider,
            mcpClient: runtime.mcpClient,
            maxMemorizeToken: this.#def.maxMemorizeToken ?? runtime.maxMemorizeToken,
            features: this.#def.features ?? runtime.features,
            ...(runtime.initData ? { initData: runtime.initData } : {}),
        };
    }
}


export function selectTools(pool: MCPTool[], names: string[]): MCPTool[] {
    const picked: MCPTool[] = [];
    for (const pattern of names) {
        const matches = pattern.endsWith("*")
            ? pool.filter(t => t.getOptions().name.startsWith(pattern.slice(0, -1)))
            : pool.filter(t => t.getOptions().name === pattern);
        for (const match of matches) {
            if (!picked.includes(match)) picked.push(match);
        }
    }
    return picked;
}

export type AgentFactoryOptions = { tools?: MCPTool[] } & AgentOverrides;

export type AgentFactory = (options?: AgentFactoryOptions) => AgentDefinition;

export default AgentDefinition;