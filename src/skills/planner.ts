import Skill from "../core/skill.js";
import {
    TodoTools,
} from "../tools/todo/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const PlannerSkill = () => new Skill({
    name: "planner",
    description: "Use this skill whenever a job is large, multi-step, vague, or spans multiple tools/domains/skills — anything with 3+ distinct steps or deliverables, work expected to take many tool calls, a job that touches several other skills at once (e.g. backend + frontend + security + verification), or an explicit request for a plan. Maintains a persistent, checkable todo list so progress survives long conversations, context resets, and detours without losing track of what's done and what's left. This is the tracking mechanism the big-task and long-task-efficiency skills both rely on for large jobs — stand this up first, before doing any work, whenever those skills are also active. Skip for single-step or trivial requests and pure question-answering with no side effects.",
    tools: [ // this is list of required tools for this job at less
        ...TodoTools(),
        ...UtilTools()
    ],
    instructions: `
# Planner Skill

## Purpose
Use this skill any time a job is too big, too vague, or too multi-step to execute in one shot. A todo list is your working memory across a long task: it lets you break a large goal into concrete, checkable steps, survive long conversations without losing track of what's done, and give the user visibility into your progress.

This skill is the tracking backbone that big-task and long-task-efficiency both depend on. big-task's core rule — never stop early, never quietly narrow scope — is only checkable if there's an actual list to check against; long-task-efficiency's checkpointing guidance assumes this list exists and stays current. On any job where those two skills are active, stand up the todo list here first, before doing any actual work, so "is this genuinely done" has a real answer instead of a guess.

## Core workflow
1. **Create the list first, before doing any work.** Call \`todo-create-list\` with a short, descriptive \`name\` (e.g. "Add auth to API"). Save the returned \`todoListId\` — every other call in this skill needs it.
2. **Break the goal into tasks up front.** Call \`todo-create-task\` once with the FULL array of tasks you can already foresee, rather than adding them one at a time as you go. Each task needs a \`name\` (short, action-oriented, e.g. "Install express and jsonwebtoken") and can have an optional \`description\` with extra detail (acceptance criteria, file paths, commands to run). Order the array the way you intend to execute them — the list has no separate "order" field, so array order in your own head/notes is what matters.
3. **Work the list one task at a time.** Before starting a task, you can call \`todo-get-list\` to refresh your view of what's done and what's pending — especially useful after a long detour, an error, or a context-compaction event, so you never have to ask the user "what was I doing?".
4. **Check off a task the moment it's genuinely complete** — call \`todo-check-task\` with \`check: true\` and the task's id. "Complete" means verified, not just attempted: if a task was "run the test suite" and tests failed, don't check it off — fix the failure first, or split it into a new task describing the fix.
5. **Adjust the plan as you learn more.** There's no in-place edit for a task's name or description — to revise one, remove the old task and create its replacement, rather than leaving stale wording in place. If a step turns out to need sub-steps you didn't foresee, call \`todo-create-task\` again to append them to the same list. If a task turns out to be unnecessary or wrong, call \`todo-remove-task\` rather than leaving it unchecked and stale — a stale task list is worse than no task list, because it misleads whoever reads it next (including future-you).
6. **Clean up when the job is done.** Once every task is checked and the user's goal is met, you generally don't need to remove the list — it stands as a record of what was done. Only call \`todo-remove-list\` if the user asks you to discard it, if the plan was abandoned/superseded, or if you're starting the same kind of job fresh and don't want stale lists cluttering \`todo-get-lists\`.

## Writing good tasks
- One task = one concrete, independently checkable action. Bad: "Build the app". Good: "Scaffold Vite project", "Install dependencies", "Implement login form", "Wire login form to /api/login", "Manually verify login flow end-to-end".
- Prefer verbs: "Create X", "Install Y", "Run Z", "Verify W".
- Put anything a future reader (or you, after a context reset) would need to resume the task — exact file paths, exact commands, exact endpoints — in the task's \`description\`, not just its \`name\`. The name is a label; the description is the instructions.
- If a task depends on another task's output (e.g. "Write tests" depends on "Implement feature"), keep them as separate tasks in dependency order rather than merging them — this keeps your checked/unchecked state an honest signal of real progress.
- Because revising a task means removing and recreating it rather than editing it in place, put real thought into a task's \`name\`/\`description\` before creating it — it's cheap to get right up front and mildly wasteful to redo.
- **A "build" task and its "verify" task are always separate tasks, never one.** "Implement the API endpoint" and "typecheck/build the API endpoint" and "verify the endpoint actually responds correctly" are three different checkable items, even though they're all part of finishing the same endpoint. Collapsing them into one task is exactly how a job gets marked done after only the first part happened.

## Multi-domain jobs — group tasks by which skill they belong to
When a job spans several other skills at once (e.g. node-backend + backend-security + react-frontend + ui-ux-design + code-verification + web-end-to-end-test, per big-task's "multi-domain big tasks" guidance), a flat unordered list of 20 tasks is hard to audit against "did every domain actually get finished." Instead:
- Cluster tasks by domain in the array you pass to \`todo-create-task\` — all the backend build/verify/secure tasks together, then all the frontend build/verify/design tasks together, then the end-to-end test tasks — even though there's no formal grouping field, keeping them contiguous in order makes the list scannable as "here's backend's full slice, here's frontend's full slice."
- For each domain touched, make sure its task cluster includes not just the build step but the domain-appropriate verification step(s) — e.g. a backend cluster should include both "implement endpoint" and "typecheck/build clean" and, if security-sensitive, "apply backend-security checklist," not just the first.
- When calling \`todo-get-list\` to check overall status on a multi-domain job, explicitly scan for any domain whose cluster has zero checked tasks — that's the concrete signal of an untouched domain that big-task warns about, and it's much easier to catch by scanning a domain-grouped list than an interleaved one.

## Multiple lists
Use \`todo-get-lists\` to see every list currently tracked. Keep one list per distinct user goal running concurrently — don't mix two unrelated jobs into a single list, since it makes "is this job done?" ambiguous. If the user starts a new, unrelated request while an old list still has unchecked tasks, ask yourself whether the old job is actually finished before assuming it's safe to ignore.

## Reporting progress to the user
When asked "what's the status?" or after finishing a meaningful chunk of work, call \`todo-get-list\` and summarize it in plain language (what's done, what's next) rather than dumping raw ids. On a multi-domain job, summarize per domain cluster (e.g. "backend: built and verified; frontend: built, not yet tested; security pass: not started") rather than one aggregate "mostly done" — an aggregate can hide an entire untouched domain, which is exactly the honest-reporting standard big-task asks for. The todo list is bookkeeping for you — the user wants a narrative, not a database dump.
`
});

export default PlannerSkill;