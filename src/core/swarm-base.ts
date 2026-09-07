import type { MessageUsage, ProviderType, StreamCallback } from "./ai-provider.js";
import { resolveAgentProviders, type AgentProvidersInput, type ProviderRegistry } from "./agent-providers.js";
import BaseAgent, { type AgentState } from "./base-agent.js";
import AgentDefinition, { type AgentFactory, type AgentOverrides, type TextOverride } from "./agent-definition.js";
import MCPClient from "./mcp-client.js";
import MCPConnection from "./mcp-connection.js";
import MCPServer from "./mcp-server.js";
import type MCPTool from "./mcp.js";
import type { AgentToolsHandle } from "../tools/agent/index.js";
import type { SwarmAgentInfo, SwarmAgentTypeInfo, SwarmController } from "../tools/agent/registry.js";

export type SwarmStreamChunk = Parameters<StreamCallback>[0] & {
    agentId: string;
};

export type SwarmStreamCallback = (chunk: SwarmStreamChunk) => Promise<void> | void;

export interface SwarmRunOptions {
    agentId?: string;
    stream?: SwarmStreamCallback;
}

export interface SwarmAgentState {
    id: string;
    type: string;
    parentId?: string;
    groups: string[];
    state: AgentState;
}

export interface SwarmState {
    default: string;
    agents: SwarmAgentState[];
}

export interface SwarmBaseProps {
    tools?: MCPTool[];
    agents: (AgentDefinition | AgentFactory)[];
    default: string;
    agentTools?: AgentToolsHandle;

    aiProvider: AgentProvidersInput;
    /** Shared by every agent in the swarm. Omit and the swarm builds one, with `tools` registered on a server of its own. */
    mcpClient?: MCPClient;
    envID?: string;

    safetyPolicies?: TextOverride;
    instruction?: TextOverride;
    maxMemorizeToken?: number;
    features?: {
        executeProviderFromMCPTool?: boolean;
    };

    overrides?: Record<string, AgentOverrides>;

    initData?: SwarmState;
}

interface SwarmAgentRecord {
    id: string;
    type: string;
    parentId?: string;
    groups: string[];
    /** Live only. Never saved, never restored — see getCurrentSwarmStates(). */
    active: boolean;
    agent: BaseAgent;
    runDepth: number;
    /** Tasked by its parent and not yet reported — see SwarmAgentInfo.awaitingReport. */
    awaitingReport: boolean;
}

export interface SwarmAgentFailure {
    agentId: string;
    type: string;
    error: string;
    timestamp: number;
}

export class SwarmBase implements SwarmController {
    #definitions = new Map<string, AgentDefinition>();
    #agents = new Map<string, SwarmAgentRecord>();
    #mainId: string = "";

    #aiProvider: AgentProvidersInput;
    /** Every provider the swarm was given, and what answers `mcp.executeProvider(...)` for the whole swarm — see #executeProvider. */
    #providers: ProviderRegistry;
    #toolProviderUsage: MessageUsage[] = [];
    #mcpClient: MCPClient;
    #ownsMCP: boolean;
    #mcpConnection?: MCPConnection;
    #maxMemorizeToken?: number;
    #features?: { executeProviderFromMCPTool?: boolean };
    #agentTools?: AgentToolsHandle;

    #subscribers = new Set<SwarmStreamCallback>();

    #inFlight = new Set<Promise<unknown>>();

    #failures: SwarmAgentFailure[] = [];

    #idCounters = new Map<string, number>();

    #runTicket = 0;

    constructor(props: SwarmBaseProps) {
        const {
            tools = [],
            agents,
            default: defaultType,
            agentTools,
            aiProvider,
            mcpClient,
            envID = "SWARM",
            safetyPolicies,
            instruction,
            maxMemorizeToken,
            features,
            overrides,
            initData,
        } = props;

        if (!agents?.length) {
            throw new Error("SwarmBase: `agents` must contain at least one agent definition or factory.");
        }

        this.#aiProvider = aiProvider;
        this.#providers = resolveAgentProviders(aiProvider);
        this.#maxMemorizeToken = maxMemorizeToken;
        this.#features = features;
        this.#agentTools = agentTools;

        for (const entry of agents) {
            const built = typeof entry === "function" ? entry({ tools }) : entry;
            const type = built.getType();
            if (this.#definitions.has(type)) {
                throw new Error(`SwarmBase: duplicate agent type "${type}" — types must be unique across the roster.`);
            }
            this.#definitions.set(
                type,
                built
                    .with({ instruction, safetyPolicies })
                    .with(overrides?.[type])
            );
        }

        this.#ownsMCP = !mcpClient;
        if (mcpClient) {
            this.#mcpClient = mcpClient;
        } else {
            this.#mcpConnection = new MCPConnection();
            const mcpServer = new MCPServer(this.#mcpConnection);
            const registered = new Set<MCPTool>();
            const toRegister = [
                ...tools,
                ...[...this.#definitions.values()].flatMap(d => d.getAllTools()),
                ...(agentTools?.tools ?? []),
            ];
            for (const tool of toRegister) {
                if (registered.has(tool)) continue;
                registered.add(tool);
                mcpServer.registerTool(tool);
            }
            this.#mcpClient = new MCPClient(envID, this.#mcpConnection);
        }

        if (agentTools) {
            agentTools.attach(this);
            this.#listen(agentTools);
        }

        if (initData) {
            this.#restore(initData);
        } else {
            const definition = this.#requireDefinition(defaultType);
            this.#mainId = this.#spawn(definition, { groups: [] }).id;
        }
    }

    #listen(agentTools: AgentToolsHandle): void {
        agentTools.on("agent-hire", (agentId, input, done) => {
            try {
                done(null, this.createAgent({
                    type: input.type,
                    parentId: agentId,
                    groups: input.group ? [input.group] : [],
                    briefing: input.briefing,
                }));
            } catch (error) {
                done(error as Error);
            }
        });

        agentTools.on("agent-fire", (_agentId, input, done) => {
            try {
                this.deactivateAgent(input.agentId);
                done();
            } catch (error) {
                done(error as Error);
            }
        });

        const deliver: Parameters<AgentToolsHandle["on"]>[1] = (_agentId, input, done) => {
            try {
                for (const target of input.to as string[]) this.sendTo(target, input.message);
                done();
            } catch (error) {
                done(error as Error);
            }
        };

        agentTools.on("agent-prompt", (agentId, input, done) => {
            for (const target of input.to as string[]) {
                const record = this.#agents.get(target);
                if (record) record.awaitingReport = true;
            }
            deliver(agentId, input, done);
        });

        agentTools.on("agent-report-parent", (agentId, input, done) => {
            const record = this.#agents.get(agentId);
            if (record) record.awaitingReport = false;
            deliver(agentId, input, done);
        });

        agentTools.on("agent-report-group", deliver);
    }

    #requireDefinition(type: string): AgentDefinition {
        const definition = this.#definitions.get(type);
        if (!definition) {
            throw new Error(`no agent type "${type}" in this swarm — available types: ${[...this.#definitions.keys()].join(", ")}.`);
        }
        return definition;
    }

    #requireRecord(agentId: string): SwarmAgentRecord {
        const record = this.#agents.get(agentId);
        if (!record) {
            throw new Error(`no agent "${agentId}" in this swarm.`);
        }
        return record;
    }

    #nextId(type: string): string {
        const next = (this.#idCounters.get(type) ?? 0) + 1;
        this.#idCounters.set(type, next);
        return `${type}-${next}`;
    }

    #restore(initData: SwarmState): void {
        for (const saved of initData.agents) {
            const definition = this.#requireDefinition(saved.type);
            this.#spawn(definition, {
                id: saved.id,
                parentId: saved.parentId,
                groups: saved.groups ?? [],
                initData: saved.state,
            });
        }

        if (!this.#agents.has(initData.default)) {
            throw new Error(`SwarmBase: initData.default "${initData.default}" is not one of the restored agents.`);
        }
        this.#mainId = initData.default;
    }

    #spawn(definition: AgentDefinition, options: {
        id?: string;
        parentId?: string;
        groups: string[];
        initData?: AgentState;
        briefing?: string;
    }): SwarmAgentRecord {
        const type = definition.getType();
        const applied = options.briefing
            ? definition.with({ instruction: { append: options.briefing } })
            : definition;

        const agent = new BaseAgent(applied.buildProps({
            aiProvider: this.#aiProvider,
            mcpClient: this.#mcpClient,
            initData: options.initData,
            maxMemorizeToken: this.#maxMemorizeToken,
            features: this.#features,
        }));

        this.#mcpClient.setExecuteProviderHandler(this.#executeProvider);

        const id = options.id ?? this.#nextId(type);
        if (this.#agents.has(id)) {
            throw new Error(`SwarmBase: duplicate agent id "${id}".`);
        }

        const suffix = Number(id.startsWith(`${type}-`) ? id.slice(type.length + 1) : NaN);
        if (Number.isInteger(suffix) && suffix > (this.#idCounters.get(type) ?? 0)) {
            this.#idCounters.set(type, suffix);
        }

        const record: SwarmAgentRecord = {
            id,
            type,
            parentId: options.parentId,
            groups: [...options.groups],
            active: true,
            agent,
            runDepth: 0,
            awaitingReport: false,
        };
        this.#agents.set(id, record);
        return record;
    }

    #executeProvider = async (toolCallId: string, type: ProviderType, input: Record<string, any>): Promise<{ output: Record<string, any> }> => {
        if (!this.#features?.executeProviderFromMCPTool) {
            throw new Error("SwarmBase#executeProvider: this feature is disabled for this swarm (features.executeProviderFromMCPTool is false).");
        }

        const provider = this.#providers.getProvider(type);
        if (!provider) {
            throw new Error(`SwarmBase#executeProvider: this swarm has no provider for type "${type}".`);
        }

        const result = await provider.chat([
            { role: "user", ...input },
        ]);

        const usage: MessageUsage[] = result.cost !== undefined
            ? [{ type, model: provider.getModel(), unit: "cost", cost: result.cost }]
            : [{
                type,
                model: provider.getModel(),
                unit: "tokens",
                inputMissTokens: (result.inputMissTokens ?? 0) + (result.inputCacheTokens ?? 0),
                inputCacheTokens: 0,
                outputTokens: result.outputTokens ?? 0,
            }];

        let attributed = false;
        for (const record of this.#agents.values()) {
            if (record.agent.recordToolCallUsage(toolCallId, usage)) {
                attributed = true;
                break;
            }
        }
        if (!attributed) this.#toolProviderUsage.push(...usage);

        return { output: { content: result.content } };
    };

    #streamFor(record: SwarmAgentRecord): StreamCallback {
        return async (chunk) => {
            if (this.#subscribers.size === 0) return;
            const tagged: SwarmStreamChunk = { ...chunk, agentId: record.id };
            for (const subscriber of [...this.#subscribers]) {
                await subscriber(tagged);
            }
        };
    }

    async #runAgent(record: SwarmAgentRecord, prompt: string): Promise<boolean> {
        record.runDepth++;
        try {
            const turn = () => record.agent.run(prompt, this.#streamFor(record));
            return await (this.#agentTools ? this.#agentTools.runAs(record.id, turn) : turn());
        } finally {
            record.runDepth--;
        }
    }

    #startRun(record: SwarmAgentRecord, prompt: string): Promise<boolean> {
        let tracked!: Promise<boolean>;
        tracked = this.#runAgent(record, prompt).finally(() => { this.#inFlight.delete(tracked); });
        this.#inFlight.add(tracked);
        return tracked;
    }

    #recordFailure(record: SwarmAgentRecord, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.#failures.push({ agentId: record.id, type: record.type, error: message, timestamp: Date.now() });

        record.awaitingReport = false;

        const parent = record.parentId ? this.#agents.get(record.parentId) : undefined;
        if (parent?.active) {
            this.sendTo(parent.id, `[failure from ${record.id} (${record.type}), an agent you hired]\nIt stopped with an error and produced no report: ${message}`);
        }
    }

    async #waitForIdle(): Promise<void> {
        while (this.#inFlight.size > 0) {
            await Promise.allSettled([...this.#inFlight]);
        }
    }

    async run(prompt: string, options?: SwarmRunOptions | SwarmStreamCallback): Promise<boolean> {
        const { agentId, stream } = typeof options === "function"
            ? { agentId: undefined, stream: options }
            : (options ?? {});

        const record = this.#requireRecord(agentId ?? this.#mainId);
        if (!record.active) {
            throw new Error(`agent "${record.id}" has been fired and can no longer be prompted.`);
        }

        const ticket = ++this.#runTicket;

        if (stream) this.#subscribers.add(stream);
        try {
            await this.#startRun(record, prompt);
            if (ticket !== this.#runTicket) return false;
            await this.#waitForIdle();
            return ticket === this.#runTicket;
        } finally {
            if (stream) this.#subscribers.delete(stream);
        }
    }

    async safeStop(): Promise<void> {
        await Promise.all(
            [...this.#agents.values()]
                .filter(record => record.runDepth > 0)
                .map(record => record.agent.safeStop())
        );
        await this.#waitForIdle();
    }

    immediateStop(): void {
        for (const record of this.#agents.values()) {
            if (record.runDepth > 0) record.agent.immediateStop();
        }
    }

    getCurrentSwarmStates(): SwarmState {
        return {
            default: this.#mainId,
            agents: [...this.#agents.values()].map(record => ({
                id: record.id,
                type: record.type,
                ...(record.parentId ? { parentId: record.parentId } : {}),
                groups: [...record.groups],
                state: record.agent.getCurrentAgentStates(),
            })),
        };
    }

    getMainAgent(): BaseAgent {
        return this.#requireRecord(this.#mainId).agent;
    }

    getMainAgentId(): string {
        return this.#mainId;
    }

    getAgent(agentId: string): BaseAgent | undefined {
        return this.#agents.get(agentId)?.agent;
    }

    getAgentIds(): string[] {
        return [...this.#agents.keys()];
    }

    getFailures(): SwarmAgentFailure[] {
        return [...this.#failures];
    }

    ownsMCP(): boolean {
        return this.#ownsMCP;
    }

    getMCPClient(): MCPClient {
        return this.#mcpClient;
    }

    close(): void {
        if (this.#ownsMCP) this.#mcpConnection?.close();
    }

    getFullTotalToken(type: ProviderType): { total: number; inputHit: number; inputMiss: number; output: number } {
        const totals = { total: 0, inputHit: 0, inputMiss: 0, output: 0 };
        for (const record of this.#agents.values()) {
            const agentTotals = record.agent.getFullTotalToken(type);
            totals.total += agentTotals.total;
            totals.inputHit += agentTotals.inputHit;
            totals.inputMiss += agentTotals.inputMiss;
            totals.output += agentTotals.output;
        }
        for (const usage of this.#toolProviderUsage) {
            if (usage.type !== type || usage.unit !== "tokens") continue;
            totals.inputMiss += usage.inputMissTokens;
            totals.inputHit += usage.inputCacheTokens;
            totals.output += usage.outputTokens;
            totals.total += usage.inputMissTokens + usage.inputCacheTokens + usage.outputTokens;
        }
        return totals;
    }

    getFullTotalCost(type: ProviderType): number {
        let cost = 0;
        for (const record of this.#agents.values()) {
            cost += record.agent.getFullTotalCost(type);
        }
        for (const usage of this.#toolProviderUsage) {
            if (usage.type === type && usage.unit === "cost") cost += usage.cost;
        }
        return cost;
    }

    listTypes(): SwarmAgentTypeInfo[] {
        const agents = [...this.#agents.values()];
        return [...this.#definitions.values()].map(definition => {
            const { type, description, rating } = definition.getDefinition();
            return {
                type,
                description,
                ...(rating ? { rating } : {}),
                active: agents.filter(r => r.active && r.type === type && r.id !== this.#mainId).length,
            };
        });
    }

    listAgents(): SwarmAgentInfo[] {
        return [...this.#agents.values()].map(record => this.#describe(record));
    }

    getAgentInfo(agentId: string): SwarmAgentInfo | undefined {
        const record = this.#agents.get(agentId);
        return record ? this.#describe(record) : undefined;
    }

    isEntrypoint(agentId: string): boolean {
        return agentId === this.#mainId;
    }

    createAgent(input: { type: string; parentId: string; groups?: string[]; briefing?: string }): SwarmAgentInfo {
        const definition = this.#requireDefinition(input.type);
        this.#requireRecord(input.parentId);
        return this.#describe(this.#spawn(definition, {
            parentId: input.parentId,
            groups: input.groups ?? [],
            briefing: input.briefing,
        }));
    }

    deactivateAgent(agentId: string): void {
        const record = this.#requireRecord(agentId);
        if (!record.active) return;
        if (record.runDepth > 0) record.agent.immediateStop();
        record.active = false;
        record.awaitingReport = false;
    }

    sendTo(agentId: string, message: string): void {
        const record = this.#requireRecord(agentId);
        void this.#startRun(record, message).catch(error => this.#recordFailure(record, error));
    }

    #describe(record: SwarmAgentRecord): SwarmAgentInfo {
        return {
            agentId: record.id,
            type: record.type,
            ...(record.parentId ? { parentId: record.parentId } : {}),
            groups: [...record.groups],
            active: record.active,
            busy: record.runDepth > 0,
            awaitingReport: record.awaitingReport,
        };
    }
}

export default SwarmBase;
