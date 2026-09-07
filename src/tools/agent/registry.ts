import { randomUUID } from "crypto";
import EventEmitter from "events";
import { AsyncLocalStorage } from "async_hooks";

export interface SwarmAgentTypeInfo {
    type: string;
    description: string;
    rating?: Record<string, number>;
    /** How many agents of this type are hired and still active right now. */
    active: number;
}

export interface SwarmAgentInfo {
    agentId: string;
    type: string;
    parentId?: string;
    groups: string[];
    active: boolean;
    busy: boolean;
    /**
     * True from the moment its parent tasks it until it reports back.
     *
     * Read together with `busy`, this is what separates the three states that
     * otherwise all look like "not running": `busy` means it is working right
     * now; `awaitingReport` without `busy` means it was given a task, is not
     * running, and has not answered — it has paused mid-task, which in practice
     * means it is blocked on something outside the swarm, such as a question
     * put to the user. Neither flag set means it is idle with nothing owed.
     *
     * Without this a parent cannot tell a paused agent from a dead one, and
     * tends to re-task or fire an agent that was only waiting.
     */
    awaitingReport: boolean;
}

/**
 * What a swarm lets the agent tools *read*. Nothing here changes anything — the
 * swarm's job is to know the state of its agents, and every action goes back to
 * it as an event instead (see AgentToolsEvent below).
 */
export interface SwarmController {
    listTypes(): SwarmAgentTypeInfo[];
    /** Every agent, active or not, in creation order. */
    listAgents(): SwarmAgentInfo[];
    getAgentInfo(agentId: string): SwarmAgentInfo | undefined;
    /** The agent the user talks to — it has no parent and cannot be fired. */
    isEntrypoint(agentId: string): boolean;
}

/**
 * Everything a tool asks the swarm to *do*. The tool has already decided it is
 * allowed (parentage, hire cap, group membership) and has already written the
 * message the receiving agent will see; the swarm only carries it out.
 *
 * - `agent-hire`   — payload `{ type, group?, briefing? }`, acked with the new `SwarmAgentInfo`
 * - `agent-fire`   — payload `{ agentId }`, acked with nothing
 * - `agent-prompt` / `agent-report-parent` / `agent-report-group`
 *                  — payload `{ to: string[], message: string }`, acked with nothing
 */
export type AgentToolsEvent =
    | "agent-hire"
    | "agent-fire"
    | "agent-prompt"
    | "agent-report-parent"
    | "agent-report-group";

/** Called by the swarm once it has carried the request out — `done(error)` to fail the tool call, `done(null, result)` to answer it. */
export type AgentToolsAck<T = void> = (error?: Error | null, result?: T) => void;

export type AgentToolsListener = (agentId: string, payload: any, done: AgentToolsAck<any>) => void;

/**
 * How long a tool waits for the swarm's ack before giving up. Every listener
 * answers immediately in practice (hiring is synchronous, delivery is
 * fire-and-forget), so this only exists to turn a wiring mistake into a legible
 * tool error instead of an agent that hangs forever.
 */
const ACK_TIMEOUT_MS = 30000;

export class AgentToolsRegistry extends EventEmitter {
    readonly id: string = randomUUID();

    #maxHired?: number;
    #controller?: SwarmController;

    /**
     * Which agent's turn we are inside.
     *
     * The whole swarm shares one MCPClient, so a tool's `execute(envID, inputs,
     * toolCallId, mcp)` gets nothing that identifies its caller. Rather than have
     * the swarm keep a tool-call-id ledger, it runs each agent's turn inside this
     * context: a tool called during that turn reads the id straight off it, and
     * parallel agents each get their own store for free.
     */
    #callers = new AsyncLocalStorage<string>();

    constructor(maxHired?: number) {
        super();
        if (maxHired !== undefined && (!Number.isInteger(maxHired) || maxHired < 1)) {
            throw new Error(`getAgentTools: maxHired must be a positive integer when given, got ${maxHired}.`);
        }
        this.#maxHired = maxHired;
    }

    getMaxHired(): number | undefined {
        return this.#maxHired;
    }

    attach(controller: SwarmController): void {
        if (this.#controller && this.#controller !== controller) {
            throw new Error(`getAgentTools: this tool set (${this.id}) is already attached to another swarm — build a separate getAgentTools() per swarm.`);
        }
        this.#controller = controller;
    }

    isAttached(): boolean {
        return this.#controller !== undefined;
    }

    requireController(): SwarmController {
        if (!this.#controller) {
            throw new Error("no swarm is attached to these agent tools — pass the getAgentTools() handle to SwarmBase as `agentTools`.");
        }
        return this.#controller;
    }

    /** Run an agent's turn labelled with its id. SwarmBase wraps every `BaseAgent.run()` in this. */
    runAs<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
        return this.#callers.run(agentId, fn);
    }

    currentAgentId(): string | undefined {
        return this.#callers.getStore();
    }

    /** The caller and the swarm, or a tool error saying which of the two is missing. */
    requireCaller(): { controller: SwarmController; agentId: string } {
        const controller = this.requireController();
        const agentId = this.#callers.getStore();
        if (!agentId) {
            throw new Error("could not tell which agent made this call — agent tools only work on agents running inside a SwarmBase.");
        }
        return { controller, agentId };
    }

    /** Ask the swarm to carry something out, and wait for its ack. */
    request<T = void>(event: AgentToolsEvent, agentId: string, payload: Record<string, any>): Promise<T> {
        if (this.listenerCount(event) === 0) {
            return Promise.reject(new Error(`no swarm is listening for "${event}" — pass the getAgentTools() handle to SwarmBase as \`agentTools\`.`));
        }

        return new Promise<T>((resolve, reject) => {
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`the swarm did not answer "${event}" within ${ACK_TIMEOUT_MS}ms.`));
            }, ACK_TIMEOUT_MS);
            timer.unref?.();

            const done: AgentToolsAck<T> = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(result as T);
            };

            this.emit(event, agentId, payload, done);
        });
    }

    /** Hired agents still active — the entrypoint agent is not one of them. */
    countHired(): number {
        const controller = this.requireController();
        return controller.listAgents().filter(a => a.active && !controller.isEntrypoint(a.agentId)).length;
    }

    getRemaining(): number | undefined {
        if (this.#maxHired === undefined) return undefined;
        return Math.max(0, this.#maxHired - this.countHired());
    }

    /** Look an agent up the way a tool needs it: with an error the model can act on. */
    requireAgent(controller: SwarmController, agentId: string): SwarmAgentInfo {
        const info = controller.getAgentInfo(agentId);
        if (!info) {
            throw new Error(`there is no agent "${agentId}" in this swarm — check agent-active for the ids that exist.`);
        }
        return info;
    }
}

export default AgentToolsRegistry;
