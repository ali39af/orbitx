import Skill from "../core/skill.js";

export const BigTaskSkill = () => new Skill({
    name: "big-task",
    description: "Use this skill whenever a task is large, long, open-ended, multi-domain, or has a wide/ambitious scope — the kind of request where the instinct is to say it's too big, offer a plan instead of doing it, do a small slice and declare victory, or hand it back to the user half-finished. Applies to any task regardless of domain: size and length of the work are not a reason to stop short of the actual goal. Also applies when a big job spans multiple other skills at once (e.g. backend, frontend, security, verification, and testing all on one build) — the risk there isn't stopping early on a single skill, it's finishing one skill's slice and declaring the whole job done while other required skills never actually ran.",
    tools: [ // this is list of required tools for this job at less
    ],
    instructions: `
# Big Task Skill

## Purpose
Some tasks are big: many files, many steps, a long build, a large refactor, a huge dataset, an ambitious feature, or a job that spans several other skills at once. Size is not an exception condition. This skill exists to counteract the failure mode of treating "this will take a while" as a reason to stop, downscope silently, or hand the work back unfinished. The job is the actual goal, not a gesture toward it.

## The core rule
Never respond to a big task by explaining that it's big instead of doing it. "This is a large task, here's how I'd approach it" is not an acceptable substitute for actually doing the task, unless the user only asked for a plan. If the user asked for the outcome, deliver the outcome. A plan, an outline, or a partial slice is only the right deliverable when that's literally what was asked for.

Do not:
- Announce that a task is big/complex/will take a long time as a reason to stop, pause, or ask "do you want me to continue?" when nothing is actually blocking you.
- Do a small representative piece of a large job and present it as if the job is done, or as a stand-in for the rest ("here's one example file, you can apply the same pattern to the rest").
- Silently narrow scope to something smaller and easier without saying so, then report success against the narrowed version.
- Stop at the first sign of friction (a long file list, a large dataset, many similar edits to make) as though friction were failure.
- Finish the part of a multi-skill job that happens to be done first (e.g. the backend) and present it as the whole job complete, when other required parts (frontend, security hardening, verification, testing) haven't been touched yet — see "Multi-domain big tasks" below.

Do:
- Break the task down (use the planner skill's todo list for anything with 3+ distinct steps or deliverables — see "Working together with planner" below) and then actually work through every item, not just the first few.
- Keep going across many tool calls and iterations if that's what the task genuinely requires. A task needing 50 edits needs 50 edits, not 5 plus an explanation of the other 45.
- If a task is repetitive (the same kind of change across many files, many rows, many components), treat the repetition as the job, not as a signal to sample it and stop.
- Push through errors, dead ends, and setbacks by adapting the approach and continuing, not by reporting the setback as if it were the final outcome.
- If real progress requires many turns or a long session, keep working turn over turn rather than pausing to ask for permission to keep going — and apply the long-task-efficiency skill's discipline so that "keep going" doesn't mean "keep going wastefully" (see below).

## Working together with planner and long-task-efficiency
On any job big enough that you might lose track of what's done and what's left, don't rely on memory alone:
- Use the **planner** skill to stand up a todo list before starting, breaking the goal into concrete checkable tasks. This is what makes "have I actually finished the big task" an answerable question rather than a vibe — check the list, don't guess.
- Use the **long-task-efficiency** skill's discipline for *how* you move through that list: batch independent work, avoid re-reading/re-fetching things that haven't changed, checkpoint so an interrupted session resumes cheaply. Big-task says "don't stop early"; long-task-efficiency says "don't waste turns while not stopping." Both apply simultaneously on a large job — neither one licenses skipping the other.
- These three skills are one workflow on a big job, not independent checklists: stand up the plan (planner), work through all of it without stopping short (big-task), and do so without wasted motion (long-task-efficiency).

## Multi-domain big tasks — don't finish one skill and call the whole job done
Some big tasks aren't just "many steps in one domain" — they span several other skills at once. Building a real feature often means: backend logic (node-backend) + security hardening (backend-security) + frontend UI (react-frontend) + design quality (ui-ux-design) + compiling/typechecking cleanly (code-verification) + actually testing it behaves correctly (web-end-to-end-test). The specific risk on this kind of job is finishing the *first* domain — usually the backend, since it's often built first — and reporting the job as done, when the frontend was never built, the security pass never happened, or nothing was ever actually clicked through in a browser.

- Before starting a multi-domain job, identify up front which of the other skills the full scope actually requires, and put a task for each domain's completion (not just its "build" step, but its verification step too) on the todo list. "Build the API" and "typecheck/verify the API" and "harden the API" are different tasks, not one task, even though they're all about the same backend.
- A domain isn't done when its code is written — it's done when the relevant verification skill for that domain has actually run (code-verification for typecheck/build; web-end-to-end-test for real behavior) and, where relevant, the security/design skills have actually been applied, not just available. Don't check off "build the frontend" the moment the component renders once — that's before ui-ux-design's states/accessibility checklist and before it's been driven end-to-end.
- If you notice you're about to present a multi-domain job as finished, explicitly check: did every domain this job actually touches get both built *and* verified, or did the last domain worked on absorb all the remaining attention while an earlier domain's verification step got silently dropped? A job isn't finished because *something* runs; it's finished because everything the user asked for actually works.

## Distinguishing genuine blockers from avoidance
Stopping early is only legitimate when something is actually, concretely blocking further progress — not because the task is large. Genuine blockers include:
- Missing information only the user has (a credential, a business decision, a preference between two valid approaches with materially different outcomes).
- An action that is destructive/irreversible and wasn't clearly authorized (deleting production data, force-pushing over history, spending real money).
- A true ambiguity where multiple reasonable interpretations of the goal would lead to substantially different work, and guessing wrong would waste significant effort.
- An external dependency that is actually unavailable (a required service is down, a resource genuinely doesn't exist).

None of these are "the task has a lot of steps." Size, length, and repetitiveness are never themselves blockers. If in doubt about whether something is a real blocker, default to continuing rather than stopping — it's better to make a reasonable assumption, state it, and keep moving than to interrupt progress on a task that could have been finished.

## Don't mistake a sandbox artifact for a genuine blocker
A specific version of "this looks blocked but isn't" comes up constantly in coding-heavy big tasks: an error, failure, or missing capability that looks like it's stopping you, but is actually just an artifact of the sandbox environment rather than a real problem with the work. Before treating something as a genuine blocker, apply the same triage as the code-verification skill:
- Is it failing only because a credential/service/database isn't present in this sandbox, but would be in the user's real deployment environment? That's not a blocker on the work itself — keep going on everything else, note it plainly, and don't let it stop unrelated parts of the task.
- Is it a platform/OS-specific capability that genuinely isn't available here but is valid in the user's target environment? Same treatment — recognize the class, don't let it halt progress on everything else.
- Only escalate to the user as a real blocker once you've actually tried to resolve it (installed the missing piece, checked real documented behavior, matched declared versions) and confirmed it's not something you can work around or verify around — "this looks like an error" is a reason to investigate, not an automatic stop.

## When you do hit a genuine blocker
State plainly and specifically what is blocking you and what you need to proceed. Don't wrap it in a broader claim that the whole task is too big — isolate the actual blocker, keep working on everything around it that isn't blocked, and only pause the blocked portion.

## Reporting progress honestly
If a big task is still in progress and you must report status (e.g. the user asks), report the real state: what's actually done, what's actually left, and what's next — not an optimistic gloss that implies more is finished than is. If the job spans multiple domains/skills, report per domain (backend: done and verified; frontend: built, not yet tested; security: not yet started) rather than one aggregate "mostly done," since an aggregate status can hide an entire untouched domain. Honest incremental progress reporting is not the same thing as stopping early; the goal is to keep working while being truthful about where things stand.
`
});

export default BigTaskSkill;