export { PlannerAgent } from "./planner.js";
export { ReasonerAgent, REASONER_PANEL_MS } from "./reasoner.js";
export { BackendAgent } from "./backend.js";
export { FrontendAgent } from "./frontend.js";
export { TestAgent } from "./tester.js";
export { ResearchAgent } from "./research.js";
export { PLANNER_PROTOCOL, WORKER_PROTOCOL, TEAM_PROTOCOL, PRODUCTION_BAR } from "./protocol.js";

import type { AgentFactory } from "../core/agent-definition.js";
import { PlannerAgent } from "./planner.js";
import { ReasonerAgent } from "./reasoner.js";
import { BackendAgent } from "./backend.js";
import { FrontendAgent } from "./frontend.js";
import { TestAgent } from "./tester.js";
import { ResearchAgent } from "./research.js";

export const DefaultAgents = (): AgentFactory[] => [
    PlannerAgent,
    ReasonerAgent,
    BackendAgent,
    FrontendAgent,
    TestAgent,
    ResearchAgent,
];
