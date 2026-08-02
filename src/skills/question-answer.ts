import Skill from "../core/skill.js";
import { QuestionAnswerTools } from "../tools/question-answer/index.js";

export const QuestionAnswerSkill = () => new Skill({
    name: "question-answer",
    description: "Use this skill whenever the agent needs information, clarification, confirmation, or a decision from the user before it can safely or correctly continue a task. Trigger this any time the next step depends on something only the user can provide — missing requirements, ambiguous instructions, a choice between multiple valid approaches, confirmation before a destructive or irreversible action, or any other point where guessing would risk doing the wrong thing. Do not use this to ask questions the agent could instead answer by reading files, running commands, or searching — only use it when the user themselves is the source of the needed information.",
    tools: [ // this is list of required tools for this job at less
        ...QuestionAnswerTools()
    ],
    instructions: `
# Question Answer Skill

## Purpose
Use this skill when the agent has reached a point where it cannot safely or correctly proceed without input from the user — missing information, genuine ambiguity, a choice between multiple reasonable paths, or confirmation before something risky or irreversible.

## The tool
There is a single tool, \`question-answer\`, which takes one input:
- \`questions\`: an array of \`{ question: string, predefinedAnswer?: string[] }\` objects.

Because it takes an array, always batch every question the agent currently needs into **one** \`question-answer\` call rather than calling the tool multiple times in a row. If the agent has three things to clarify, that's one call with three entries in \`questions\`, not three separate calls.

Use \`predefinedAnswer\` to offer suggested/likely answers as a list of short strings when reasonable options exist (e.g. \`["yes", "no"]\` or \`["PostgreSQL", "MySQL", "SQLite"]\`). Leave it out for genuinely open-ended questions.

## Core rule: ask, then stop
When questions need to be asked, call \`question-answer\` with all of them and then **do nothing else**. Do not:
- Continue reasoning about the task
- Make assumptions and proceed anyway "just in case"
- Call other tools
- Produce a final answer or summary
- Call \`question-answer\` again in the same turn

This tool has \`stopIterationAfterUsingThisTool\` set — the agent's turn ends automatically by system logic the moment it's called. The tool call itself is the entire action for that turn. The user's answers will arrive as a new turn, at which point the agent resumes normally using them.

## When to ask vs. when not to ask
Ask the user when:
- Required information is missing and cannot be discovered by reading files, running commands, or searching
- The task is ambiguous enough that different reasonable interpretations would lead to meaningfully different outcomes
- Multiple valid approaches exist and the choice depends on user preference, not technical correctness
- An action is destructive, irreversible, or high-cost (e.g. deleting data, spending money, sending something externally) and confirmation is warranted

Do not ask when:
- The answer can be found by inspecting the project, files, or environment directly — investigate first, ask second
- The ambiguity is minor and a sensible default exists — pick the default, note the assumption, and proceed
- The agent already asked this same question earlier in the conversation and got an answer

## How to ask
- Batch all currently-needed questions into the single \`questions\` array for one tool call — don't split related questions across multiple calls.
- Phrase each question so it's understandable on its own, with enough context that the user doesn't need to re-read the whole conversation.
- Supply \`predefinedAnswer\` options where a small set of likely answers exists, to make answering faster for the user.

## After the tool call
Nothing. The agent does not add commentary, does not summarize what it's about to do next, and does not speculate about likely answers. The turn is over as soon as \`question-answer\` is called — the system handles pausing and waiting for the user's response.
`
});

export default QuestionAnswerSkill;