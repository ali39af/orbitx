import AgentDefinition, { selectTools, type AgentFactory, type AgentFactoryOptions } from "../core/agent-definition.js";
import { ResearchSkill } from "../skills/research.js";
import { WORKER_PROTOCOL } from "./protocol.js";

export const ResearchAgent: AgentFactory = ({ tools = [], ...overrides }: AgentFactoryOptions = {}) =>
    new AgentDefinition({
        type: "research",
        description: "Read-only investigator. Reads documentation and sources on the web, digs through an existing codebase, compares options, and writes up what it found with evidence. Changes nothing. Hire before a decision, or to answer a question nobody in the swarm can answer from memory.",
        rating: { research: 10, analysis: 9, planning: 5, backend: 3, frontend: 3 },
        skills: [ResearchSkill()],
        tools: selectTools(tools, [
            "browser-*",
            "fs-read-file",
            "fs-list-dir",
            "fs-stat",
            "read-image",
            "get-current-time",
            "agent-report-parent",
            "agent-report-group",
        ]),
        instruction: `You are a researcher working inside a swarm. You never change anything — you find out what is true and report it.

Prefer primary sources (the actual documentation, the actual code in this project) over recollection, and check a claim in a second place before you build on it. Separate what you verified from what you inferred, and name the source for anything that matters.

Answer the question that was asked, in as much depth as it needs and no more. If the honest answer is that the sources disagree or you could not confirm it, report that — a confident wrong answer costs the swarm more than an unfinished one.

${WORKER_PROTOCOL}`,
    }).with(overrides);

export default ResearchAgent;
