import type WorkerAgent from "../../core/worker-agent.js";
import type { WorkerAgentRating } from "../../core/worker-agent.js";

export interface AgentInfo {
    name: string;
    description: string;
    rating: WorkerAgentRating;
    hired: boolean;
}

/**
 * In-memory catalog of WorkerAgents a planner can see/hire/prompt, plus
 * which of them are currently "active" (hired). Scoped to one AgentTools()
 * call — not a process-wide singleton — so multiple independent planners in
 * the same process each get their own roster and hire state.
 *
 * WorkerAgent instances are live objects (their own AI provider, message
 * history, etc.), not serializable data, so — unlike MCPTool state such as
 * TodoTools' lists — this can't live in MCPStorage. The roster itself is
 * fixed at construction (only the developer can safely wire up a worker's
 * provider/instruction/tools); the model can only hire/prompt from what's
 * already here, never create new ones.
 */
export class AgentRegistry {
    #agents = new Map<string, WorkerAgent>();
    #hired = new Set<string>();
    #maxHired?: number;

    constructor(agents: WorkerAgent[], maxHired?: number) {
        if (maxHired !== undefined && (!Number.isInteger(maxHired) || maxHired < 1)) {
            throw new Error(`AgentTools: maxHired must be a positive integer when given, got ${maxHired}.`);
        }
        this.#maxHired = maxHired;

        for (const agent of agents) {
            const name = agent.getName();
            if (this.#agents.has(name)) {
                throw new Error(`AgentTools: duplicate worker agent name "${name}" — names must be unique across the roster.`);
            }
            this.#agents.set(name, agent);
        }
    }

    getMaxHired(): number | undefined {
        return this.#maxHired;
    }

    getHiredCount(): number {
        return this.#hired.size;
    }

    list(): AgentInfo[] {
        return [...this.#agents.values()].map(agent => ({
            name: agent.getName(),
            description: agent.getDescription(),
            rating: agent.getRating(),
            hired: this.#hired.has(agent.getName()),
        }));
    }

    hire(name: string): void {
        if (!this.#agents.has(name)) {
            throw new Error(`no worker agent named "${name}" — check agent-list for available names.`);
        }
        // Re-hiring an already-hired agent is a no-op — it must never count
        // against the limit a second time.
        if (this.#hired.has(name)) {
            return;
        }
        if (this.#maxHired !== undefined && this.#hired.size >= this.#maxHired) {
            throw new Error(
                `cannot hire "${name}" — maximum of ${this.#maxHired} hired agent(s) already reached ` +
                `(currently hired: ${[...this.#hired].join(", ") || "none"}).`
            );
        }
        this.#hired.add(name);
    }

    isHired(name: string): boolean {
        return this.#hired.has(name);
    }

    get(name: string): WorkerAgent | undefined {
        return this.#agents.get(name);
    }
}

export default AgentRegistry;
