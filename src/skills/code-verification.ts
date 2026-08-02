import Skill from "../core/skill.js";
import {
    FsTools,
} from "../tools/fs/index.js";
import {
    BashTools,
} from "../tools/bash/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const CodeVerificationSkill = () => new Skill({
    name: "code-verification",
    description: "Use this skill before handing off any non-trivial code change or new code to the user — in any language, not just TypeScript. Covers running the appropriate type checker, compiler, build, linter, or test suite to catch real bugs before the user sees them, and distinguishing genuine bugs from false positives caused by sandbox limitations (missing env vars/credentials, unavailable external services, a partial file the user pasted without its surrounding project, a platform-specific API that doesn't exist in this environment but would in the user's). Trigger this alongside node-backend, react-frontend, or any other language/framework skill for real code — not just when the user explicitly asks to 'check for bugs.' Also trigger when the user pastes an isolated code snippet/file and asks for review, since the same triage logic (real bug vs. missing-context artifact) applies there too.",
    tools: [
        ...FsTools(),
        ...BashTools(),
        ...UtilTools()
    ],
    instructions: `
# Code Verification Skill

## Purpose
Writing code that looks right is not the same as code that's actually right. Before handing anything back as finished, run the strongest available check for that language/project — a type checker, a compiler/build, a linter, a test suite — and read the actual output. "It looks correct" is not a substitute for "it typechecks/compiles/builds/passes," when any of those are available. This is the same principle as the framework skills' "verify it runs" sections, generalized across languages and pushed one step earlier: catch the bug before the user does, not after.

## Core rule
Never hand off non-trivial code changes without running the appropriate verification step for that language, if the tooling is available in the environment. If it genuinely isn't available (no compiler installed, no network access to fetch a toolchain, etc.), say so explicitly rather than silently skipping verification and presenting the code as checked.

## Choosing the right check per language
- **TypeScript**: run the project's type checker (\`tsc --noEmit\`, or the project's existing \`npm run typecheck\`/\`build\` script if one exists — prefer the project's own script over inventing a raw command, since it'll carry the right config/paths). Read the actual diagnostic output, not just the exit code.
- **JavaScript (no types)**: run the project's linter if configured (ESLint etc.) and, if there's a build step (bundler, transpiler), run that too — a build failure catches syntax and some logic errors even without types.
- **Python**: run a type checker if the project uses type hints and has one configured (mypy, pyright), run the linter if configured (ruff, flake8), and run the test suite if one exists. If there are no types/tests/linter at all, at minimum do a syntax/import check by attempting to run or import the module.
- **C / C++**: actually build it (the project's existing build system — CMake, Make, etc. — rather than inventing a raw compiler invocation that skips the project's real flags/includes). A change that "looks like valid C++" but doesn't compile is not verified; compile it and read the actual compiler errors/warnings, don't just proofread the diff.
- **Go**: \`go build\` and \`go vet\` at minimum; \`go test\` if a test suite exists.
- **Rust**: \`cargo build\` (or \`cargo check\` for a faster pass) and \`cargo clippy\` if available; \`cargo test\` if a test suite exists.
- **Any other language**: find and use whatever the project's own strongest static check and/or build step is (check for existing scripts/config in the project — a Makefile, CI config, or package manifest scripts section usually reveals the intended check) rather than skipping verification because it's not one of the above.
- **No compiler/type system at all available for the language/setup**: fall back to actually running the code (or the specific changed path, or a representative test call) rather than only reading it, so at least a runtime smoke-check happens.

## Triage: real bug vs. sandbox-context false positive
This is the step that's easy to get wrong in the other direction — treating every error the checker prints as something you must "fix" by guessing, even when the error is actually just an artifact of the code running outside its real environment. Before treating a diagnostic as a genuine bug to fix, ask:

- **Is this failing because a credential/env var/service isn't present in this sandbox, but would be in the user's real environment?** (A DB connection failing because there's no DB running here; an API call failing because there's no real API key configured here.) This is not a code bug — don't "fix" it by changing the code to work around a missing sandbox dependency. Note it to the user as expected-to-work-once-deployed-with-real-config, rather than silently declaring it broken or silently declaring it fine without checking which case it is.
- **Is this a partial file/snippet the user gave you, missing surrounding project context that would resolve the error** (an import of a sibling file that wasn't shared, a type defined elsewhere in their actual project)? If so, the error may be a genuine artifact of incomplete context rather than a real bug in what they actually have. Say this plainly rather than either (a) inventing a stub definition that might not match their real one, or (b) reporting a "bug" that may not exist in their full project. If a reasonable guess at the missing piece is possible and low-risk, you can offer it, clearly labeled as an assumption.
- **Is this a platform/OS/architecture-specific API that doesn't exist or behaves differently in this sandbox but is valid and available in the user's actual target environment** (a native mobile API, a specific OS syscall, a GPU/hardware-specific call, a browser-only API with no DOM here)? Recognize this class rather than treating "doesn't exist here" as "doesn't exist, full stop." Cross-check against documentation/knowledge of that platform rather than assuming the sandbox's behavior is universal truth.
- **Is this a dependency/version mismatch specific to the sandbox** (a package that isn't installed here but is listed correctly in the project's manifest, a version pinned differently) — try installing/matching the project's actual declared versions before concluding the code itself is wrong.

**How to tell the difference in practice:** try to actually resolve it first (install the missing package, check if an env var can be stubbed safely for a smoke test, look up the platform API's real documented behavior) before concluding it's environmental — don't jump to "must be a sandbox limitation" as an excuse to skip a check that's actually catching a real bug. The default assumption should be that a checker's output is real and worth investigating; "this is probably just the sandbox" is a conclusion you reach after trying to resolve it, not a first response to any red output.

## Fixing real bugs before handoff
Once you've triaged and confirmed a diagnostic is a genuine bug (not an environment artifact):
1. Fix it, then re-run the same check to confirm the specific diagnostic is actually gone — don't assume a fix worked without re-verifying, and don't move to the next error while a fix for a previous one is unconfirmed.
2. If fixing one diagnostic could plausibly introduce or reveal another (e.g. a type fix that changes a function's signature and affects callers), re-run the full check afterward, not just spot-check the one line you touched.
3. If a large number of diagnostics appear at once, apply the big-task skill's discipline — work through all of them, don't fix a handful and present the rest as "minor issues you can clean up later" unless they are genuinely out of scope (e.g. pre-existing issues in code you didn't touch, which should be mentioned but not silently fixed as scope creep either).

## What to tell the user
When you hand off verified code, be explicit and honest about what was actually checked versus what couldn't be:
- "Typechecked clean with \`tsc --noEmit\`" / "Builds successfully with \`cargo build\`" / "Ran the test suite, all passing" — state what you actually ran.
- If something couldn't be verified (no toolchain available, a check requires credentials/services not present in the sandbox), say so explicitly rather than implying full verification happened — e.g. "I couldn't run this against a real database in this sandbox, so the query logic is typechecked/reviewed but not execution-tested against live data."
- If you identified likely sandbox-only failures (env-dependent, platform-specific), name them specifically rather than bundling them silently into "a few warnings you can ignore" — the user should know exactly what was and wasn't confirmed, and why.

## Relationship to other skills
This skill is the generalized, language-agnostic version of the "verify it actually runs" sections already present in node-backend and react-frontend — apply this skill's triage logic there too rather than treating those sections as sufficient on their own for anything beyond "does the dev server start." For UI-facing changes specifically, this skill covers typecheck/build/compile-level correctness; actual behavioral/rendered verification in a browser is covered by the web-app-testing and ui-ux-design skills — use both together for a frontend change (this skill: does it compile/typecheck cleanly; web-app-testing: does it actually behave correctly when clicked/used).
`
});

export default CodeVerificationSkill;