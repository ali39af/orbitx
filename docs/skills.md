# Skills

A `Skill` bundles instructions with the tools those instructions depend on, so including the skill in an agent gets you both at once — the tools are auto-registered, and the instructions are folded into the system prompt under a `SKILLS:` block.

```ts
class Skill {
  constructor(skill: {
    name: string;
    description: string;
    instructions: string;
    tools: MCPTool<any>[];
  });
  getSkill(): { name; description; instructions; tools };
}
```

`description` is shown alongside `instructions` in the system prompt (`${name} - ${description}` followed by the instructions text) — write it as a short "when to use this" pointer, since it's the model's first signal for whether the skill is relevant to the current task.

## Built-in skills

| Skill | Purpose |
|---|---|
| `PlannerSkill` | Stands up a persistent, checkable todo list (via `TodoTools`) for any large/multi-step/vague job so progress survives long conversations and context resets. |
| `BigTaskSkill` | Keeps the agent from stopping short on large or ambitious jobs — no declaring victory on a partial slice, no handing a big job back half-finished. |
| `LongTaskEfficiencySkill` | Keeps a long job efficient — batching, avoiding redundant reads, checkpointing — without giving up on getting through the full scope. |
| `NodeBackendSkill` | Building, running, and debugging Node.js backends: APIs, servers, CLIs, workers, schedulers, DB access layers. |
| `ReactFrontendSkill` | Building, running, and debugging modern React (`.tsx`/`.jsx`) projects, typically Vite-scaffolded. |
| `UiUxDesignSkill` | Visual and interaction design quality for user-facing UI — layout, hierarchy, feedback states, accessibility, responsiveness. |
| `BackendSecuritySkill` | Hardening server-side code that touches auth, sessions, tokens, uploads, DB queries, payments, or any trust boundary. |
| `CodeVerificationSkill` | Running the right type checker/build/lint/test suite before handing code back, and telling real bugs apart from sandbox artifacts. |
| `WebEndToEndTestSkill` | Testing a live web app like a real user would (fill, click, navigate) and verifying via the rendered page, console, and network. |
| `ResearchSkill` | Answering questions that need real, current information from the live web — cross-checks multiple sources. |
| `ShoppingSkill` | Purchase-decision help — real current listings, prices, links, and review sentiment instead of recommending from memory. |
| `PresentSkill` | Deciding how to hand back a job's output as files (individually or zipped) and cleaning build artifacts out first — pairs with `PresentTools`. |
| `QuestionAnswerSkill` | Pausing to ask the user for missing information, a decision, or confirmation before continuing, instead of guessing — batches every pending question into one call and stops the turn immediately after asking (`QuestionAnswerTool` sets `stopIterationAfterUsingThisTool`). |
| `QuestionAnswerSkill` | Wraps `QuestionAnswerTool` with instructions for when it's appropriate to stop and ask the human operator a clarifying question. |

Each of these lives in its own file under `src/skills/` and is a plain factory function (`PlannerSkill()`), same convention as tools.

## Writing a custom skill

```ts
import { Skill, FsReadFileTool, FsWriteFileTool } from "orbitx";
import { SumTool } from "./sum-tool.js";

export const MathHelperSkill = () => new Skill({
  name: "math-helper",
  description:
    "Use this skill whenever the user asks for arithmetic that should be computed exactly " +
    "rather than estimated from the model's own reasoning — sums, running totals, or " +
    "anything written to a file afterward.",
  instructions: `
- Always use the math-sum tool for addition instead of computing it yourself.
- If asked to save a result, write it to disk with fs-write-file and confirm the path back to the user.
  `,
  tools: [SumTool(), FsReadFileTool(), FsWriteFileTool()],
});
```

```ts
const agent = new SimpleAgent({
  aiProvider: provider,
  instruction: "You are a helpful assistant.",
  skills: [MathHelperSkill()],
});
```

If a tool is already passed in `tools` *and* included inside a skill, `SimpleAgent` de-duplicates it — you won't get it registered twice. If you're building on `BaseAgent` directly instead, remember `allowedTools` and each skill's `tools` are two separate lists that both need to reach the same `MCPServer` registration — `SimpleAgent`'s constructor is the reference implementation for getting this wiring right.
