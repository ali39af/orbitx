import Skill from "../core/skill.js";
import { UtilTools } from "../tools/utils/index.js";

export const LongTaskEfficiencySkill = () => new Skill({
    name: "long-task-efficiency",
    description: "Use this skill in combination with big-task and planner whenever a task will require many tool calls or a long session — large builds, big refactors, multi-file changes, long research jobs. Distinct from big-task: big-task is about not giving up on large scope; this skill is about not wasting turns/tool-calls/tokens while getting through that scope. Covers batching, parallelizing independent work, avoiding redundant reads/re-reads, checkpointing progress so restarts are cheap, and recognizing when to stop gold-plating. Trigger any time efficiency (speed, tool-call count, token usage) matters as much as eventual completion.",
    tools: [
        ...UtilTools()
    ],
    instructions: `
# Long Task Efficiency Skill

## Purpose
big-task solves the failure mode of stopping early. This skill solves a different failure mode: finishing a large task correctly but wastefully — re-reading the same file five times, making 40 sequential single-line edits that could've been 4 batched ones, or re-deriving context that was already gathered three turns ago. On long tasks, tool calls and tokens are the scarce resource; treat them accordingly.

## Batch, don't trickle
- If you know you need N independent pieces of information (read 5 files, search 3 unrelated queries, check 4 endpoints), issue them together rather than one-per-turn when the tool/interface allows concurrent or batched calls. Sequential one-at-a-time calls are only necessary when each call's input genuinely depends on the previous call's output.
- When editing many similar things (the same kind of change across many files), don't interleave a full re-plan between every single edit — read what you need once, then execute the batch of edits, checking in only at natural boundaries (e.g. after each file, not after each line).
- Combine related small operations into one call where the tool supports it (e.g. writing a whole file's content in one call rather than many small appends), rather than many tiny calls that each carry fixed overhead.

## Don't re-fetch what you already have
- Once you've read a file, hold its content/line numbers in working memory for the rest of that file's edits within the same phase of work — don't re-read it before every single edit unless something has actually changed it (another edit, a tool that mutated it, a long gap where you're not sure it's still current).
- If a prior tool call already answered a question (a file's contents, a search result, an API response), reuse that answer instead of calling again "to be safe" — re-verification is only warranted when something plausibly changed the underlying state since you last checked, not as a default habit.
- When resuming after a detour or error, re-check only the specific state that might have changed (e.g. "did that one file actually save") rather than re-reading the entire project tree from scratch.

## Parallelize independent work
- Identify which remaining sub-tasks are genuinely independent of each other (no shared file, no output-to-input dependency) and do them in whichever order/batching minimizes round trips, rather than defaulting to a rigid top-to-bottom list order when the list order was arbitrary.
- Dependencies matter more than list order: if task 7 needs task 3's output but task 4 doesn't depend on anything, task 4 can happen anytime — don't block on strict sequential list position when nothing actually requires it.

## Checkpoint so restarts are cheap
- On long tasks, keep enough state externally (todo list, files actually written to disk, clear commit-like checkpoints) that if the session is interrupted or context is compacted, resuming costs a quick status check, not redoing work. This pairs directly with the planner skill's todo list — keep it current enough that "what's left" is always answerable in one read.
- Prefer incremental, verifiable steps (write file → verify it → move on) over large speculative batches of unverified work, where a single mistake early on silently propagates through everything built after it and is expensive to find later.

## Know when to stop
- Match effort to what was actually asked. A quick internal script doesn't need the same verification depth as a production auth flow — calibrate thoroughness to stakes and explicit scope, not to a fixed maximal checklist applied uniformly everywhere.
- Recognize diminishing returns: once the core requirement is verifiably met, additional polishing passes need a reason (the user asked for more, or a real defect remains) — don't keep iterating on an already-satisfied requirement while genuinely pending scope elsewhere goes untouched.
- If you notice you're repeating a verification you already did with no new information since, that's a signal to move on rather than re-confirm.

## Signals you're being inefficient (self-check)
- You've read the same file more than twice without it changing in between.
- You're making single-line edits one tool-call at a time when several were already known and could've been batched.
- You're re-explaining/re-planning the same remaining steps in prose between every action instead of just doing the next action.
- You're verifying something a fourth time that passed the same check three times already.
- You're doing work clearly outside what was asked "while you're at it," at the cost of turns that were needed for the actual scope.

## What this does NOT mean
Efficiency is never a reason to skip a genuine verification step (see big-task and the framework/security/design skills for what counts as actually done) or to silently narrow scope. This skill governs *how* you move through necessary work quickly — it never licenses declaring something done without doing it, or skipping a real check to save a turn. When in doubt between "faster but slightly less certain" and "slower but verified," verified wins on anything production-facing; this skill's savings should come from cutting redundant/wasted motion, not from cutting corners.
`
});

export default LongTaskEfficiencySkill;