import Skill from "../core/skill.js";
import { BrowserTools } from "../tools/browser/index.js";
import { UtilTools } from "../tools/utils/index.js";


export const WebEndToEndTestSkill = () => new Skill({
    name: "web-end-to-end-test",
    description: "Use this skill whenever the user asks to test, check, verify, QA, or confirm that a website or web application actually works — a login flow, a form, a checkout, a button, a newly built feature, a bug fix, or any user-facing behavior on a live or locally-running web app. Also use this proactively right after building or changing a frontend or full-stack feature, before calling it done — not just when explicitly asked to test. Drives a real headless browser to act like an actual user: fills forms, clicks buttons, navigates, and then verifies the real outcome via the rendered page, console errors, and network requests/responses — never by reading source code and assuming it works. Covers both the UI layer (does it render/click/navigate correctly) and the API layer it talks to (does the backend actually receive the right request and respond correctly) — trigger this for full-stack verification, not just visual checks. Trigger this any time \"does it work\", \"test this\", or \"make sure X happens when Y\" applies to a running web app rather than to static code review.",
    tools: [ // this is list of required tools for this job at less
        ...BrowserTools(),
        ...UtilTools()
    ],
    instructions: `
# Web End-to-End Test Skill

## Before you start: know what "pass" means
Before touching the browser, be explicit (to yourself, and to the user if it's ambiguous) about what you're testing and what a pass looks like. "Test the login form" is vague — pin it down: "submitting valid credentials navigates to /dashboard and shows the user's name; submitting invalid credentials shows an error message and stays on /login." Vague test goals produce vague, unreliable verdicts. If the ask is genuinely ambiguous about scope (one flow vs. the whole app) or environment (which URL/port), ask before starting rather than guessing.

This skill pairs with code-verification (typecheck/build/lint clean before you even open a browser) — don't use browser-driven testing as a substitute for a basic static check; use both. code-verification catches "doesn't compile"; this skill catches "compiles but doesn't actually behave correctly."

## Core loop
1. **Open a session** at the app's URL and keep its session id for the whole test.
2. **Read the page** to get an outline of the UI with reference ids for every element you'll need to interact with. You act only on refs you actually read — never guess a selector.
3. **Drive the interaction exactly like a real user would**: fill fields, click buttons and links, submit forms. For a form with no visible submit button, submit it the way a real user still could — via enter-to-submit on a field, or a direct form submission.
4. **Re-read after every state-changing action.** Never assume a click worked. Take a fresh read and inspect the new state — refs from before the action are stale the instant the DOM changes, so don't reuse them.
5. **Assert on real evidence, not assumptions** — see below.
6. **Report a clear verdict per scenario**: pass or fail, with the concrete evidence observed (what the page showed, what console/network showed) — never just "it seems to work."

## Workflow order: real functionality first, then stop and offer more
When this skill runs at the end of building or changing a feature, test in this order and don't skip ahead:
1. **First, verify the real, intended functionality actually works** — the happy path a genuine user would take, end to end, with valid realistic input. This is the test that matters most and is never optional.
2. **Once the real functionality is confirmed working, stop iterating and report.** Give the user a clear pass/fail verdict on what they asked you to build, with the evidence observed.
3. **Then separately offer, don't just do, further testing**: tell the user something like "if you want, I can also test some invalid-input/edge-case and basic security handling on the frontend." Don't launch into a long negative-testing pass unprompted — it burns time and tool calls the user may not want yet, and premature edge-case failures can distract from confirming the actual feature works at all.
4. **Only run negative/edge-case/security testing after the user says yes** (or if they asked for it as part of the original request up front). When they do confirm, keep it to basic, frontend-facing checks — this is not a substitute for a dedicated security audit (see backend-security for that).

## What counts as evidence
Never conclude "it works" just because an action didn't visibly error. Confirm the actual expected outcome:
- **Visible outcome**: re-read the page and check the outline genuinely shows what should be there — a success message, the new URL's content, a newly-rendered element, an item now present in a list.
- **Console output**: check for logged JS errors a user wouldn't see but that indicate something broke silently. An action that "completes" but throws a console error afterward is not a pass.
- **Network activity**: for anything that should hit an API (form submit, add-to-cart, save), confirm the request was actually sent and that the response status/body match what's expected. A button that looks like it worked but never called the API is a classic silent failure this catches.
- **Load state**: before asserting on a page's content, make sure the page has actually finished loading and isn't still mid-request — especially on JS-heavy apps where content renders asynchronously after navigation. If it's still loading, wait briefly and recheck rather than reading too early.

## Timing: don't mistake "not rendered yet" for "broken"
This is the single most common false-positive in this skill: reading the page immediately after an action, seeing no error message and no success message either, and concluding the app is broken — when the truth is the request/response/re-render simply hadn't landed yet. Before you report any failure that looks like "expected error/success message never appeared" or "the app just sat there and did nothing", stop and rule out timing first:
1. **Check network status before trusting a "nothing happened" read.** If browser-network-status still reports \`loading\`, or you never explicitly checked it, that's not evidence of a bug — it's evidence you read too early. Wait briefly and re-read before drawing any conclusion.
2. **Never read exactly once and decide.** If the first re-read after an action shows no visible change, wait a short beat and read again (once, maybe twice) before concluding anything is wrong. A single immediate read that finds nothing is not a failed assertion — it's an incomplete one.
3. **Don't overcorrect into a stall either.** This cuts both ways: don't loop indefinitely re-reading the same page hoping something eventually appears. A couple of short, deliberate re-checks (confirming network is idle, then reading) is enough — if the expected outcome still isn't there after that, check console and network activity for the real cause (see "Investigating a failure" below) instead of continuing to poll blindly.
4. **When in doubt about whether "no error appeared" means pass or means "too early", check the concrete signal, not the absence of one.** "The error message isn't on the page" only means the app is broken if you've also confirmed the request actually completed (network idle, response received) and the render had a chance to happen. If either of those hasn't happened yet, that's the actual reason nothing showed up — go verify it, don't guess.
5. **Same logic applies to slow-appearing errors on invalid input.** A validation error that renders after the request round-trip completes is not "the error didn't appear" if you checked before the round-trip finished — confirm network idle first, then check for the message.

## Backend/API-layer verification (not just the UI)
A UI test that only checks "did the page show a success message" can miss a backend that silently no-oped, wrote the wrong data, or returned a misleading status. When the flow under test involves a real backend, verify both sides:
- **Confirm the actual request sent**, not just that one was sent — check the network activity for method, endpoint, and payload, and sanity-check the payload matches what the form/action should have produced (right field names, right values, not sending stale/empty data).
- **Confirm the actual response**, not just "no error was thrown" — check the status code is what's expected (200/201 for success, proper 4xx for a deliberately invalid submission — not a 200 with an error buried in the body, unless that's genuinely the API's documented contract) and that the response body contains what the UI then rendered, rather than assuming the UI's display is an accurate reflection of what the server actually returned.
- **Where feasible, verify server-side state directly** rather than only trusting the UI's re-render as proof — e.g. if there's an accessible way to query the backend/DB state directly (an admin endpoint, a status API, a way to run a query via bash-run against a local dev DB), confirm the write actually persisted rather than inferring it purely from the client re-rendering an optimistic update that hasn't actually been confirmed by the server.
- **Test the API's error handling directly, not just via the UI**: if the environment allows issuing a raw request (e.g. \`curl\` via bash-run, or a direct fetch from the browser tools) with a deliberately malformed/unauthorized payload, do so, and confirm the backend rejects it correctly — a UI that happens to only ever send valid data can mask a backend that has no real server-side validation at all (see backend-security for what proper validation looks like).
- If the frontend and backend are both something you built in this session, don't let a clean-looking UI substitute for confirming the backend actually did the right thing — the UI can be wrong about what happened, especially if it optimistically updates before the server confirms.

## Negative / edge case testing (only after confirming real functionality, and only if the user wants it)
Don't test only the happy path when this step is in scope. For any input field, try: empty submission, obviously invalid input (bad email format, out-of-range number), and boundary values — then confirm the app's error handling actually surfaces a message to the user (check the re-read outline for an error string) rather than silently failing or crashing (check console for a thrown error). Where a backend is involved, also confirm the *server* rejected the invalid input (see above) rather than only checking that the frontend's own client-side validation caught it — client-side-only validation that passes this test but has no server-side counterpart is a real gap to flag, not a pass.

## Investigating a failure
When something doesn't behave as expected:
1. Re-read the page to see the actual current state.
2. Check console output for a thrown error explaining what happened.
3. Check network activity to see if a request was even sent, and if so, whether the server returned an error status or unexpected body.
4. If the backend is available to inspect directly (logs, a local dev server's own console output via bash-logs), check there too — a frontend-only investigation can miss that the real failure was a server-side exception that got swallowed into a generic error response.
5. Inspect page internals directly only as a last resort, for something the outline genuinely can't show (e.g. a specific JS variable's value) — don't use this to drive the test itself, since that stops testing the real user-facing UI.
Report the root cause found, not just "the test failed."

## Hygiene
- Use one session per logical test flow so navigation/interaction history stays coherent. Open a fresh session for an unrelated flow (e.g. testing signup vs. testing checkout as an already-logged-in user) so state from one doesn't leak into the other.
- Always close a session once its test flow is complete.
- If you started a backend dev server specifically to run this test (rather than testing against something already running), stop it once verification is complete, consistent with node-backend's/react-frontend's own process hygiene — don't leave test-only processes running indefinitely.
`
});

export default WebEndToEndTestSkill;