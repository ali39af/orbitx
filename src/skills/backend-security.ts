import Skill from "../core/skill.js";
import {
    FsTools,
} from "../tools/fs/index.js";
import {
    BashTools,
} from "../tools/bash/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const BackendSecuritySkill = () => new Skill({
    name: "backend-security",
    description: "Use this skill whenever writing, reviewing, or hardening any server-side code that handles authentication, user input, sessions, tokens, file uploads, database queries, payments, or any data that crosses a trust boundary (client to server, or one service to another). Applies regardless of framework or language. Trigger this alongside node-backend (or any other backend skill) for production code — not just when the user explicitly says 'security' — since insecure-by-default code is not production-ready even if functionally correct. Also trigger for security-focused reviews of existing code, dependency audits, and questions about auth/session/secret handling.",
    tools: [
        ...FsTools(),
        ...BashTools(),
        ...UtilTools()
    ],
    instructions: `
# Backend Security Skill

## Purpose
Functionally-correct backend code is not the same as production-ready backend code. This skill is the security pass that has to happen alongside (not instead of) building the feature — treat it as part of "done," not an optional hardening step for later. Apply this whenever code touches auth, user input, sessions, secrets, file handling, or a database, regardless of which backend framework skill is also active.

## Core rule
Never ship an endpoint that trusts client input, an unvalidated body, an unchecked auth header, or a raw string built into a query, "for now" or "to get it working first." Security is not a separate pass you do after the feature works — build it in from the first version, because retrofitting it later means finding every place trust was assumed and that search is easy to get wrong.

## Input validation and sanitization
- Validate every piece of external input (body, query params, path params, headers, uploaded file metadata) against an explicit schema (e.g. zod, joi, express-validator) before it touches business logic — never pass \`req.body\` straight into a service or query.
- Reject unexpected/extra fields rather than silently ignoring them (mass-assignment risk) — don't spread \`req.body\` directly into a DB write/update without an explicit allowlist of fields.
- Validate types, lengths, and formats server-side even if the frontend already validates — client-side validation is a UX nicety, not a security boundary; assume any client-side check can be bypassed entirely.

## Authentication and sessions
- Never store passwords in plaintext or with a fast general-purpose hash (MD5, SHA-256 alone) — use bcrypt/argon2/scrypt with an appropriate work factor.
- Never put sensitive data (passwords, full tokens, secrets) in JWT payloads — JWTs are signed, not encrypted, and are readable by anyone who has the token.
- Set cookie flags correctly for session/auth cookies: \`HttpOnly\` (blocks JS access, mitigates XSS token theft), \`Secure\` (HTTPS only), \`SameSite=Strict\` or \`Lax\` (mitigates CSRF) unless there's a specific cross-site need that's been explicitly considered.
- Expire and rotate tokens/sessions; implement refresh-token rotation or short-lived access tokens rather than one long-lived token that never expires.
- Rate-limit authentication endpoints specifically (login, password reset, signup) — these are brute-force targets even if the rest of the API isn't rate-limited as aggressively.

## Authorization (never just authentication)
- Authenticating a request ("who is this") is not the same as authorizing it ("are they allowed to do this specific thing to this specific resource"). Every endpoint that reads/writes a resource by ID must check that the authenticated user actually owns/can-access that specific resource — never just check "is logged in" and trust the ID in the URL/body (this is IDOR — Insecure Direct Object Reference, one of the most common real-world API vulns).
- Centralize authorization logic (middleware or a shared helper) rather than re-implementing ad hoc ownership checks per-route, which is easy to forget on a new endpoint.

## Injection prevention
- Never build a SQL/NoSQL query by string-concatenating user input. Use parameterized queries / prepared statements, or an ORM/query-builder that parameterizes by default. This applies equally to "just one quick query" written directly in a controller for convenience.
- For any use of a shell command, template engine, or eval-like function with user-influenced input, treat it as an injection risk and avoid interpolating raw input into it; prefer passing arguments as separate parameters (e.g. \`execFile\` with an args array, not \`exec\` with a concatenated string).
- Sanitize/escape any user input that will be rendered back as HTML (stored/reflected XSS) — don't rely on "the frontend framework probably escapes this" without confirming it actually does for the specific rendering path used.

## Secrets and configuration
- Never hardcode API keys, DB credentials, or signing secrets in source files. Use environment variables, and confirm a \`.env.example\` (without real values) exists so the requirement is visible without leaking the actual secret.
- Never commit a real \`.env\` file — check for and add a \`.gitignore\` entry if one doesn't already exist when creating a new project.
- Don't log secrets, full tokens, passwords, or full request bodies that might contain them — redact sensitive fields before logging.

## File uploads
- Validate uploaded file type by actual content/magic bytes where feasible, not just the client-supplied extension or MIME type header, both of which are trivially spoofable.
- Enforce a file size limit server-side, not just in frontend UI.
- Store uploads outside the web root or behind access control, and never execute uploaded files.

## Dependencies and surface area
- Run \`npm audit\` (or equivalent) after adding dependencies to a production project and flag any high/critical findings to the user rather than silently ignoring them.
- Prefer minimal, actively-maintained dependencies over adding a new package for something a few lines of code could do, especially for anything touching crypto/auth — don't hand-roll crypto primitives, but also don't add an obscure unmaintained auth library when a well-established one exists.
- Set security-relevant HTTP headers (e.g. via \`helmet\` in Express) — CSP, X-Content-Type-Options, X-Frame-Options, etc. — rather than leaving framework defaults that omit them.

## Error handling and information disclosure
- Never return raw stack traces, internal error messages, or DB error details to the client in production — log the detail server-side, return a generic message client-side.
- Don't let error responses leak whether a resource/user exists when they shouldn't (e.g. "no such user" vs "wrong password" on login — prefer a single generic "invalid credentials" for both, to prevent user enumeration).

## Verifying the hardening actually works
Writing the mitigation is not the job — confirming it holds is:
1. For an auth-gated endpoint, actually test it unauthenticated and with a different user's token/session to confirm it's rejected, not just that the happy path with the right user works.
2. For validated input, actually send malformed/oversized/wrong-type input and confirm it's rejected with a sane error, not a 500 or a silent pass-through.
3. For rate-limited endpoints, confirm the limit actually triggers under repeated requests rather than assuming the middleware is configured correctly.
4. Re-check after any refactor that moved validation/auth logic — a moved middleware that's no longer wired into the route is a silent regression.

## When this is a genuine tradeoff, not negligence
Some contexts (an internal prototype, a throwaway script, an explicitly-scoped demo) may reasonably skip some of this. In that case, say so explicitly to the user rather than silently skipping — "this is fine for a prototype but would need auth/rate-limiting/input validation before going to production" — so the gap is a known, stated tradeoff rather than a silent gap discovered later.
`
});

export default BackendSecuritySkill;