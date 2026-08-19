import BaseAgent from "./base-agent.js";

/**
 * Per-task-type fit score for a WorkerAgent, e.g. `{ backend: 9, frontend: 4,
 * "3d-web": 10 }`. Keys are free-form task-type labels chosen by whoever
 * builds the roster; there's no fixed enum since "what counts as a task
 * type" is app-specific. Convention (not enforced): 0-10, higher is a
 * better fit. AgentListTool hands this straight to the hiring agent so it
 * can judge which worker fits a given task.
 */
export type WorkerAgentRating = Record<string, number>;

/**
 * EXPERIMENTAL: this class, and the agent-management tools built on it
 * (src/tools/agent/), are new and still settling — names and behavior may
 * change in a future release.
 *
 * A BaseAgent with an identity a *hiring* agent can reason about — name,
 * description (persona/specialty), and a rating per task type — so it can
 * be listed, compared against other workers, and hired via the tools in
 * `src/tools/agent/` (see AgentTools()). Everything about running it (tool
 * dispatch, memory, streaming) is unchanged from BaseAgent; WorkerAgent only
 * adds metadata on top.
 *
 * Like BaseAgent, this is a raw building block: you still bring your own
 * `mcpClient`/`allowedTools`. If you want this worker to be able to report
 * back to whoever hired it, include AgentReportTool() (from
 * `src/tools/agent/`) in its own tools, same as any other tool.
 */
export class WorkerAgent extends BaseAgent {
    #name: string;
    #description: string;
    #rating: WorkerAgentRating;

    constructor({
        name,
        description,
        rating = {},
        ...baseAgentOptions
    }: {
        /** Unique identifier used by AgentTools() to hire/prompt this worker — must be unique across whatever roster it's included in. */
        name: string;
        /** Persona/specialty shown to the hiring agent via agent-list — what this worker is good at, written for the model to judge fit from, not just a human label. */
        description: string;
        /** Per-task-type fit score — see WorkerAgentRating. Defaults to empty (no stated specialty). */
        rating?: WorkerAgentRating;
    } & ConstructorParameters<typeof BaseAgent>[0]) {
        super(baseAgentOptions);
        this.#name = name;
        this.#description = description;
        this.#rating = rating;
    }

    getName(): string {
        return this.#name;
    }

    getDescription(): string {
        return this.#description;
    }

    getRating(): WorkerAgentRating {
        return this.#rating;
    }
}

export default WorkerAgent;
