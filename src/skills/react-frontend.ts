import Skill from "../core/skill.js";
import {
    FsTools,
} from "../tools/fs/index.js";
import {
    BashTools,
} from "../tools/bash/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const ReactFrontendSkill = () => new Skill({
    name: "react-frontend",
    description: "Use this skill whenever the task involves building, modifying, running, or debugging a modern React project (.tsx or .jsx), typically Vite-scaffolded — creating new components or pages, adding features to an existing React app, fixing a rendering or state bug, wiring up routing/forms/data-fetching, starting or restarting a dev server, or running a production build. Also covers scaffolding a brand-new React project from scratch. Trigger this for any React/frontend coding task, whether the project already exists on disk or needs to be created.",
    tools: [ // this is list of required tools for this job at less
        ...FsTools(),
        ...BashTools(),
        ...UtilTools()
    ],
    instructions: `
# React Frontend Skill

## Purpose
Use this skill when building, modifying, or running a modern React project (TSX or JSX), typically scaffolded with Vite.

## Project structure (mandatory for new projects)

Don't let every component pile up flat in \`src/\`. Pick a structure up front based on project size and stick to it:

**Small/medium projects (a handful of pages, one cohesive app):** type-first:
\`\`\`
src/
  components/     # reusable, presentational building blocks (Button, Modal, Card)
  pages/          # route-level components, one per route/screen
  hooks/          # custom hooks (useAuth, useFetch, etc.)
  services/       # API calls / data-fetching layer — no component ever calls fetch()/axios directly, it goes through here
  context/        # React context providers, or store/ if using a state library (Zustand, Redux)
  utils/          # pure helper functions
  types/          # shared TS types/interfaces (TSX projects only)
  assets/         # images, fonts, static files
  App.tsx
  main.tsx
\`\`\`

**Larger projects (many distinct features/domains, e.g. "checkout", "profile", "admin" that don't share much UI):** feature-first, where each feature owns its own slice:
\`\`\`
src/
  features/
    checkout/
      components/
      hooks/
      checkout.service.ts
      CheckoutPage.tsx
    profile/
      components/
      hooks/
      profile.service.ts
      ProfilePage.tsx
  components/     # truly shared/cross-feature components only (Button, Modal)
  hooks/          # truly shared hooks only
  services/       # shared API client setup (base fetch wrapper, auth interceptor)
  context/ or store/
  utils/
  types/
  App.tsx
  main.tsx
\`\`\`

**Choosing between them:** default to type-first for anything that's clearly one small-to-medium app. Switch to feature-first once distinct product areas stop sharing much and cross-navigating \`components/\`/\`hooks/\` to find "everything related to checkout" becomes tedious. If the project already has an established convention, match it rather than imposing a different one mid-project.

**Regardless of which convention:**
- Presentational components (in \`components/\`) should not fetch data directly — data fetching lives in \`services/\`, wired up via hooks, and passed down as props or accessed via a hook the component calls.
- Pages/route-level components can orchestrate hooks and services but should delegate actual rendering detail to smaller components rather than being 500-line files.
- Don't hardcode API base URLs inline in a component or service file — centralize them via \`import.meta.env.VITE_*\` and a single API client module, so there's one place to change the base URL.
- Co-locate a component's styles/tests with the component itself (e.g. \`Button.tsx\`, \`Button.module.css\`, \`Button.test.tsx\` in the same folder) rather than separating by file type across the whole project.

For any real user-facing UI, apply the ui-ux-design skill alongside this one — a component that renders and handles clicks but has no loading/empty/error states, no keyboard accessibility, or generic unexamined styling is not a finished deliverable.

Before handoff, pair this skill with code-verification (typecheck/build clean — for TSX projects, \`tsc --noEmit\` or the project's own typecheck script) and web-end-to-end-test (actually drive the running app in a browser and confirm real behavior) — a component that "looks right" in source but hasn't been typechecked and hasn't actually been clicked through in a live session is not verified.

## Starting a new project
Scaffold with Vite via \`bash-run\` (use \`cwd\` for where it should be created, and a real project name instead of "my-app" unless the user hasn't specified one):
- React + TypeScript: \`npm create vite@latest my-app -- --template react-ts --no-interactive --eslint\`
- React + JavaScript: \`npm create vite@latest my-app -- --template react --no-interactive --eslint\`

Then:
1. \`npm install\` (or \`npm i\`) with \`cwd\` set to the new project folder — required before anything will run.
2. \`npm run dev\` via \`bash-run\` to start the dev server. This is a long-running process: it will return with status \`"running"\` once \`waitMs\` elapses rather than exiting. Save the \`processId\`.
3. Confirm it actually started by checking the output/\`bash-logs\` for the local dev URL (e.g. "Local: http://localhost:5173/") rather than assuming success just because the command didn't error immediately.

## Working with an existing project
- \`fs-list-dir\` (recursive when needed, paged via \`offsetResult\`/\`limitResult\` for large trees) before assuming the project's structure — check whether it uses \`src/\` conventions, a router, a state library, TSX vs JSX, before writing new code.
- Read \`package.json\` first to see what's already installed (React version, router, UI library, styling approach — Tailwind vs CSS modules vs styled-components etc.) and match it. Don't introduce a second styling system or router into a project that already has one.
- Prefer targeted edits (replacing a specific line range) over rewriting a whole existing file, so unrelated code isn't accidentally dropped. Read the file first to get current line numbers, since prior edits may have shifted them — a full-file overwrite has no undo, so treat it as safe only for brand-new files or after reviewing the complete current content.

## Component and code conventions
- Match the existing file's extension and import style: if the project is \`.tsx\`, write typed props; if \`.jsx\`, don't introduce TypeScript syntax.
- Keep components focused — one component per concern; extract a sub-component rather than letting one file grow unmanageable, matching whatever granularity the existing codebase already uses.
- Follow the existing project's conventions for state management, data fetching, and styling rather than introducing your own preferred pattern from scratch.
- Don't leave unused imports, dead code, or commented-out blocks behind after an edit.

## Running and verifying your work
Writing a component is not the job — confirming it renders and behaves correctly is:
1. Make sure the dev server is running, starting it if not.
2. After a change, check the dev server's logs for compile errors — Vite/React will report these there before you ever open a browser.
3. If a build is required for the task (not just dev iteration), actually run the production build and check the output for errors/warnings rather than assuming a clean dev server means the production build also succeeds.
4. When the change is behavior-sensitive (a form, a click handler, navigation, data fetching) and browser tools are available in this environment, actually drive the running dev server with the browser tools (open a session at the dev URL, read the page, interact, re-read) to confirm the real rendered behavior matches intent — don't rely on "the code looks right" alone.
5. Stop the dev server when done verifying, unless the user wants it left running for their own use.

## Common pitfalls to avoid
- Forgetting to actually install a dependency after adding it to \`package.json\` by hand — reference in code is not enough.
- Starting a second dev server on the same port when one is already running — check running processes first.
- Editing a file without reading it first — targeted line-based edits require accurate current line numbers, and guessing them corrupts the file.
- Hardcoding API URLs/secrets into frontend source — these ship to the browser in plain text; use environment variables (Vite: \`import.meta.env.VITE_*\`) and flag to the user if a required \`.env\` value is missing.
`
});

export default ReactFrontendSkill;