import Skill from "../core/skill.js";
import {
    FsTools,
} from "../tools/fs/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const UiUxDesignSkill = () => new Skill({
    name: "ui-ux-design",
    description: "Use this skill whenever building or modifying any user-facing UI — web pages, components, forms, dashboards, landing pages, mobile-web layouts — regardless of framework. Covers visual design quality (layout, spacing, typography, color, hierarchy), interaction design (feedback states, loading/empty/error states, affordances), accessibility, and responsive behavior. Trigger this alongside react-frontend (or any other frontend skill) for any real UI work, not just when the user explicitly asks for 'good design' — a functionally-working but visually generic or inaccessible UI is not production-ready. Also trigger when asked to review, critique, or improve the look/feel/usability of an existing interface.",
    tools: [
        ...FsTools(),
        ...UtilTools()
    ],
    instructions: `
# UI/UX Design Skill

## Purpose
A UI that "works" (renders, handles clicks, doesn't crash) is not the same as a UI that's actually good. This skill is the design-quality pass that happens alongside building the feature, not a separate polish step reserved for later. Generic, default-Bootstrap-looking, inaccessible, or state-incomplete UI is not a finished deliverable even if every button technically fires its handler.

## Core rule
Never ship a UI as "done" if it only handles the happy path visually — no loading state, no empty state, no error state — or if it's built from unexamined framework defaults with no deliberate visual decisions made. A production UI has been through at least one real design decision on layout, hierarchy, and states; it wasn't just assembled from default component styles and called finished.

## Visual hierarchy and layout
- Every screen needs one clear primary action/focus — not three equally-weighted buttons competing for attention. Decide what matters most on this screen and make it visually dominant (size, color, position); make secondary actions visually secondary.
- Use consistent spacing based on a scale (e.g. 4px/8px increments), not arbitrary one-off pixel values scattered across components — inconsistent spacing is one of the fastest ways a UI reads as "unpolished" even when nothing is technically broken.
- Group related elements with proximity and whitespace rather than borders/dividers for every separation — over-boxing everything reads as cluttered.
- Respect a consistent grid/alignment — misaligned edges across a page (a card 3px off from the one next to it) are visually cheap to fix and expensive to ignore.

## Typography
- Limit to 2 typefaces (often just 1 with weight variation) and a deliberate type scale (e.g. 12/14/16/20/24/32px) rather than ad hoc font sizes chosen per-element.
- Body text needs sufficient line-height (typically 1.4–1.6x font size) and a comfortable measure (line length) — don't let text run edge-to-edge on wide containers; constrain max-width for readability.
- Don't rely on font size alone for hierarchy — weight, color, and spacing all contribute; a heading that's just "bigger" with the same weight and color as body text often isn't distinct enough.

## Color and contrast
- Establish a small deliberate palette (primary, secondary/accent, neutral grays, semantic colors for success/warning/error) rather than picking colors ad hoc per component.
- Check text-to-background contrast meets at least WCAG AA (4.5:1 for normal text, 3:1 for large text) — don't ship light-gray-on-white body text or low-contrast placeholder-style text for actual content.
- Don't rely on color alone to convey meaning (e.g. red/green only for status) — pair with an icon, label, or pattern so the UI still communicates for colorblind users.

## Interaction and feedback states
Every interactive element needs its full state set considered, not just the default appearance:
- **Hover/focus/active/disabled** states for buttons, links, and inputs — a button that looks identical whether it's clickable or disabled is a real usability bug.
- **Loading state** for anything async (data fetch, form submit) — never leave a screen visually static while something is happening in the background; use a spinner, skeleton, or disabled+labeled button ("Saving...") so the user knows work is in progress.
- **Empty state** for any list/table/dashboard that can have zero items — a blank white screen with no explanation is a dead end; show a message and, where relevant, a clear next action.
- **Error state** for anything that can fail (failed fetch, failed validation, failed submit) — surface a specific, human-readable message near the relevant field/section, not just a console error or a generic toast with no detail.
- Form validation errors should appear near the field they concern and describe what's wrong and how to fix it ("Email must include an @") rather than a generic "Invalid input."

## Accessibility (non-negotiable baseline)
- All interactive elements must be reachable and operable via keyboard alone (tab order, enter/space to activate) — don't build click-only interactions with a \`div\` + \`onClick\` where a real \`button\`/\`a\` element would give this for free.
- Use semantic HTML elements (\`button\`, \`nav\`, \`header\`, \`main\`, \`label\`) over generic \`div\`/\`span\` with visual-only styling — screen readers depend on semantics, not appearance.
- Every form input needs an associated \`label\` (via \`htmlFor\`/\`id\` or wrapping) — a placeholder is not a label and disappears on focus.
- Every meaningful image needs alt text; purely decorative images should have empty alt (\`alt=""\`) so screen readers skip them rather than reading a filename.
- Don't trap focus or remove visible focus outlines (\`outline: none\`) without providing a clear visible alternative focus style — keyboard users need to see where they are.

## Responsive behavior
- Design/verify at minimum three widths: mobile (~375px), tablet (~768px), desktop (~1280px+) — don't build and check only at one viewport and assume the rest follows.
- Avoid fixed pixel widths on containers that should flex; use relative units and flexible layouts (flexbox/grid) so content reflows rather than overflowing or clipping at smaller widths.
- Touch targets on mobile-facing UI need adequate size (roughly 44x44px minimum) — don't shrink tappable controls to fit more on screen.

## Avoiding "generic AI-generated UI" look
- Don't default to purple-gradient-on-white with a centered card and a drop shadow on everything — that's a recognizable unexamined default, not a design decision. Make at least one deliberate, specific visual choice appropriate to the actual product/brand context rather than reaching for the first framework default.
- Vary visual weight deliberately rather than making every card/section the same size, padding, and shadow — sameness across a page reads as templated.
- If the user hasn't specified a visual direction, pick one (a specific mood/tone — minimal, playful, editorial, dense-data, etc.) and apply it consistently rather than landing in an undirected middle.

## Verifying the design actually holds up
Writing the CSS/markup is not the job — confirming it renders and behaves as intended is:
1. Actually view the rendered result (screenshot, browser tool, or dev server) rather than judging by reading JSX/CSS alone — layout bugs are often invisible in source and obvious on screen.
2. Check it at multiple viewport widths, not just the one the dev tools happened to default to.
3. Tab through interactive elements to confirm keyboard operability and visible focus states actually work, not just that they're coded.
4. Trigger the loading/empty/error states deliberately (e.g. throttle network, submit invalid input, clear a list) to confirm they render as intended rather than assuming the conditional logic is correct from reading it.
`
});

export default UiUxDesignSkill;