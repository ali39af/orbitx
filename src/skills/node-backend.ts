import Skill from "../core/skill.js";
import {
    FsTools,
} from "../tools/fs/index.js";
import {
    BashTools,
} from "../tools/bash/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const NodeBackendSkill = () => new Skill({
    name: "node-backend",
    description: "Use this skill whenever the task involves building, modifying, running, or debugging a Node.js backend — REST/GraphQL APIs, servers, CLIs, background workers, schedulers, database access layers, or any server-side/non-browser Node code. Covers scaffolding a brand-new Node project from scratch as well as extending or fixing an existing one. Trigger this for any backend Node.js coding task, whether the project already exists on disk or needs to be created.",
    tools: [ // this is list of required tools for this job at less
        ...FsTools(),
        ...BashTools(),
        ...UtilTools()
    ],
    instructions: `
# Node.js Backend Skill

## Purpose
Use this skill when building, modifying, or running a modern Node.js backend project: APIs, servers, CLIs, background workers, and anything else that runs on Node rather than in a browser.

## Project structure (mandatory for new projects)

Never dump routes, DB calls, and business logic into one or two files "for now." Pick a structure up front based on project size, and stick to it as the project grows — retrofitting structure onto a pile of flat files later is expensive and error-prone. Two acceptable conventions:

**Small/medium projects (single cohesive domain, roughly under ~15 endpoints, one team):** layer-first (MVC-style):
\`\`\`
src/
  controllers/   # request/response handling only — parse input, call a service, shape the response
  services/      # business logic — the actual "what does this operation do"
  models/        # data shape + persistence (ORM models/schemas, or raw query functions)
  routes/        # route definitions, mapping HTTP verb+path -> controller
  middleware/    # auth, validation, error handling, logging, rate limiting
  config/        # env loading, DB connection, constants
  utils/         # pure helper functions with no framework/business dependency
  app.js         # wires middleware + routes together, exports the app
  server.js      # starts the HTTP server (imports app.js) — keep this separate from app.js so tests can import app.js without binding a port
\`\`\`

**Larger projects (multiple distinct domains/features, e.g. "orders", "users", "billing" that don't share much logic):** feature-first (domain-based), where each feature owns its own slice:
\`\`\`
src/
  features/
    orders/
      order.controller.js
      order.service.js
      order.model.js
      order.routes.js
    users/
      user.controller.js
      user.service.js
      user.model.js
      user.routes.js
  middleware/    # shared/cross-cutting only
  config/
  utils/
  app.js
  server.js
\`\`\`

**Choosing between them:** default to layer-first for anything that's clearly one small-to-medium app. Switch to feature-first once you notice the layer-first folders (\`controllers/\`, \`models/\`, etc.) are accumulating multiple unrelated domains and cross-referencing between them is getting confusing — at that point, feature-first keeps each domain's controller/service/model/routes together and easier to reason about in isolation. If genuinely unsure, ask which the user's team already prefers rather than guessing; if there's no existing convention to match, layer-first is the safer default for anything not already known to be large.

**Regardless of which convention:**
- Controllers must never contain raw SQL/query-builder calls or business rules directly — that belongs in services/models. A controller's job is: validate/parse request → call service → send response → handle/forward errors.
- Services must never touch \`req\`/\`res\` directly — that keeps business logic testable without spinning up an HTTP server.
- Route files should be thin: they map paths to controller functions and attach route-specific middleware (e.g. an auth guard, a validator), nothing else.
- If you inherit an existing project that doesn't follow either convention, match its existing structure rather than silently imposing a new one mid-project — flag the mismatch to the user instead if it's bad enough to be worth raising.

For production APIs, apply the backend-security skill alongside this one — a functionally-correct endpoint that skips input validation, authorization checks, or secret handling is not production-ready.

Before handoff, also apply code-verification — for a TypeScript backend, typecheck clean (\`tsc --noEmit\` or the project's own script); for any backend, this pairs with the "verifying your work actually runs" section below rather than replacing it: typecheck/build first, then actually start the server and hit real endpoints as described there.

## Starting a new project
1. Create the project folder: \`fs-create-dir\`.
2. Initialize it: \`bash-run\` with command \`npm init -y\` and \`cwd\` set to the new folder. This creates \`package.json\`.
3. Decide and install your stack (see "Choosing dependencies" below), then \`npm install\` them with \`cwd\` set to the project folder.
4. Write source files with \`fs-write-file\` (creates parent directories automatically unless \`createDirs: false\`), following the project structure above.
5. Add npm scripts (\`start\`, \`dev\`, \`test\`, \`build\` as relevant) to \`package.json\` via \`fs-edit-file\` or \`fs-write-file\`, so the project is runnable the standard way rather than requiring you to remember a raw command.

## Working with an existing project
- Always \`fs-list-dir\` (with \`recursive: true\` when you need the whole tree — page through it with \`offsetResult\`/\`limitResult\` if it's large) before assuming a project's structure. Don't guess file layout.
- Read \`package.json\` first with \`fs-read-file\` to learn the existing scripts, dependencies, and module type (\`"type": "module"\` vs CommonJS) before writing new code — new code must match the project's existing conventions (ESM \`import\`/\`export\` vs CommonJS \`require\`), not your own default assumption.
- Prefer targeted edits (replacing a specific line range) over reading a whole file and rewriting it wholesale, which risks losing unrelated content if the rewrite is incomplete. Read the file first to get accurate current line numbers — another edit may have shifted them since you last looked. A full-file overwrite has no undo — only safe for genuinely new files, or when you've already reviewed everything being replaced.

## Running processes
- Use \`bash-run\` for anything that runs to completion (installs, one-off scripts, migrations, tests). It waits up to \`waitMs\` (default 15s) and returns the tail of output; increase \`waitMs\` for slow installs instead of polling immediately.
- Use \`bash-run\` for long-running/endless processes too (e.g. \`npm run dev\`, \`node server.js\` with no exit) — it returns early with status \`"running"\` once \`waitMs\` elapses, and the process keeps going in the background. Save the returned \`processId\`.
- Poll a long-running process with \`bash-wait\` (blocks up to \`waitMs\` again) or \`bash-logs\` (pages through everything the process has printed so far via \`offsetLine\`/\`limitLine\`) to check whether it started successfully — e.g. confirm a server actually printed "listening on port 3000" rather than assuming it did.
- If a command prompts interactively (a CLI asking "overwrite? (y/n)" or "project name:"), use \`bash-write-input\` to answer it rather than letting it hang.
- Always \`bash-terminate\` a long-running dev/watch process once you're done testing it, so it doesn't keep occupying its port for the next run.
- Check \`bash-list\` if you're not sure what's still running — don't start a second server on the same port blind.

## Verifying your work actually runs
Writing the code is not the job — confirming it runs is. After writing or changing backend code:
1. Install any new dependencies you referenced (\`npm install <pkg>\`), don't just import them and assume they exist.
2. Start the server/script with \`bash-run\` and check the output (or \`bash-logs\`) for a successful startup message and the absence of stack traces.
3. For an HTTP server, actually hit an endpoint (e.g. \`curl http://localhost:PORT/...\` via \`bash-run\`) and check the response, rather than trusting that "it started" means "it works".
4. If there's a test suite, run it (\`npm test\` or equivalent) and read the actual output — don't report success from the exit code alone if the tail of output shows failures.
5. Terminate any long-running process you started for verification once you've confirmed it works, unless the user wants it left running.

## Choosing dependencies
- Prefer well-established, actively maintained packages appropriate to what's already in \`package.json\` (don't introduce a second framework/ORM/etc. alongside one already in use without a clear reason).
- Check the installed version actually landed as expected by reading \`package.json\`/\`package-lock.json\` after install if it matters for compatibility.
- Keep the dependency footprint proportionate to the task — don't pull in a large framework for something a few lines of native Node can do, unless the project already uses that framework.

## Code quality expectations
- Match the project's existing style, module system, and error-handling conventions.
- Handle errors explicitly (don't let unhandled promise rejections or missing try/catch around I/O silently crash the process) — a backend that crashes on the first bad request is not "done".
- Don't hardcode secrets/credentials into source files; use environment variables and mention this to the user if a \`.env\` file is expected but missing.
`
});

export default NodeBackendSkill;