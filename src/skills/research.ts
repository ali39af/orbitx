import Skill from "../core/skill.js";
import { BrowserTools } from "../tools/browser/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const ResearchSkill = () => new Skill({
    name: "research",
    description: "Use this skill whenever a question needs real, current information from the live web rather than training data — current events, prices, recent releases, live documentation, specific facts that could have changed, comparisons, or anything the agent isn't fully certain about. Drives a real headless browser: opens search engines and pages, reads them, clicks through, fills and submits forms, waits for slow/JS-heavy pages to finish loading, and cross-checks multiple independent sources before answering — never treats a single opened page as a finished answer. Trigger this any time an answer would otherwise be a guess, could be outdated, needs verification from an actual live source instead of memory, or spans enough distinct sub-questions/sources that it should be planned rather than done ad hoc. For large research jobs (many sub-questions, a full report, a comparison across many items), this skill works together with the planner skill (to track sub-questions as checkable tasks) and the long-task-efficiency skill (to avoid wasteful re-opening/re-reading across a long session) — treat all three as one workflow on big jobs, not separate silos.",
    tools: [ // this is list of required tools for this job at less
        ...BrowserTools(),
        ...UtilTools()
    ],
    instructions: `
# Research Skill

## Mindset: one source is a data point, not an answer
A search engine's results page is a list of guesses, not an answer, and a single opened page is one person's/one outlet's account, not the truth. The single most common way research goes wrong is stopping the moment *something* was found — opening one page, reading a plausible-sounding paragraph, and reporting it as fact. Never do this. Treat "I found a page that says X" and "I have confirmed X" as two different states, and don't report the second when you've only reached the first.

The bar for "done": you have opened and actually read **multiple independent sources** that agree (or you've explicitly noted where and why they disagree), not just multiple search results skimmed from a results page. Independent means different publishers/authors/original data — three news aggregators repeating the same wire story are one source, not three.

**How many sources is enough** scales with stakes:
- A single stable, easily-verified fact (a date, a definition, a spec value from an official doc) — one authoritative primary source can be enough, but prefer the primary source itself (official docs, the company's own page, a primary filing) over a summary of it.
- Anything numeric, time-sensitive, or where sources could disagree (prices, statistics, "current" status, recent events) — corroborate across at least 2–3 independent sources before reporting a number or status as settled.
- Anything contested, high-stakes, or where you notice initial sources disagree — keep going until the disagreement is either resolved or explicitly characterized as an open disagreement in your answer. Don't average conflicting numbers or silently pick one; open more sources specifically to adjudicate, or report the split.
- A broad/open-ended question (a comparison, "what are the best X," a full research report) — this isn't a few-source job, it's a many-source job; see "Scaling to bigger jobs" below.

## Search engine strategy
- **Never use Google** as your search entry point — it blocks automated/headless browsers and will waste a turn on a block page or CAPTCHA before you even get results. Default to **DuckDuckGo first**; fall back to **Bing** if DuckDuckGo's results are thin, stale, or don't surface what you need for a particular query. If the user already named an exact site/URL to use, go straight there instead of a general search engine.
- Vary your query phrasing meaningfully between attempts — a query that comes back thin is a signal to reformulate (different terms, add a year/date, name a more specific source, change the angle), not to re-run the same phrase on a second engine and call it a new attempt.
- Prefer going straight to a known authoritative domain when you already know where the answer lives (official docs, a company's own blog/press page, a government or standards site) rather than routing everything through a general search engine first.

## Handling bot checks and CAPTCHAs — skip, don't fight
- If a page shows a CAPTCHA, "verify you're human," a hard login wall, or any other bot-check, **do not attempt to solve it and do not retry the same page more than once.** Abandon that source immediately and pick a different result. There are almost always other sources with equivalent information; burning turns fighting a bot check is close to always the wrong tradeoff versus just moving to the next link.
- The same applies to paywalled or clearly spam/low-quality/SEO-farm pages — recognize them quickly (thin content, no author/publisher, content that doesn't match the title) and move on rather than trying to extract signal from a bad source.
- Google specifically is likely to bot-check headless traffic on the results page itself — this is the main reason to avoid it as an entry point, not just a stylistic preference.

## Core loop
1. **Open a session** on a search engine (DuckDuckGo, falling back to Bing) or a known site if you already know exactly where to look. Keep track of its session id — every other browser action needs it.
2. **Read the page** to get a structured outline of headings, text, links, buttons, and form fields, each tagged with a reference id you use to act on it. You cannot see pixels — only this outline — so never guess a selector or a URL; only act on refs you actually read.
3. **Check the page is actually ready before you trust it.** JS-heavy pages can still be loading when you first read them. If a page looks sparse, blank, or mid-load, check whether network requests are still pending. If they are, wait briefly and re-check rather than reading immediately — don't just barrel ahead and read a half-loaded page as if it were final. If a page seems broken, unexpectedly empty, or a submitted form seems to have done nothing, check the page's logged console output for errors before deciding it failed.
4. **Act** — click a link/button ref, or fill a text field ref with a value. For a plain search box with no visible submit button, fill it and submit on enter, or submit the form directly by its ref.
5. **Re-read after every action that changes the page.** Refs from before an action are stale the instant the DOM changes — a click, a navigation, a form submit, a scroll that lazy-loads new content. Always take a fresh read after any of these before your next action.
6. **When reading a long page**, if the output is truncated, continue reading the *same* snapshot using the continuation reference provided rather than re-reading from scratch — re-reading from scratch mid-page hands you an entirely new set of refs and silently invalidates the ones you already noted. Only take a fresh (non-continuation) read when the page itself has actually changed.
7. **Go deep, not just wide on the results page.** Read the search results outline, pick several promising links by their ref, and open each in turn — don't stop after skimming just the results page text. Aim to actually visit enough distinct sources that you could defend your answer if challenged, not just the first hit.
8. **If a page is slow or looks incomplete**, use the delay utility to give it time to finish loading, then re-check network activity and re-read, instead of immediately giving up on the source or reporting incomplete content as if it were complete.
9. **Close every session** you opened once you're done with it. Don't leave sessions open, and don't open a new session per page — reuse one session across an entire line of research; multiple navigations within the same session are normal and expected.

## Content that only appears after scrolling or clicking a tab — a common false negative
A page reading as "sparse" or "missing the section I need" is not always the whole story. Many sites lazy-load content only once it's scrolled into view, or hide it behind a tab/accordion that isn't expanded by default: comment sections, review sections, extended specs, citation/reference lists, "read more" truncated article bodies, and related-content sections are all commonly gated this way. If you expected a page to contain something (a count/summary near the top implies more detail exists further down — e.g. a visible review count or comment count with no actual review/comment text shown yet) and don't see it in your first read, don't conclude it's absent:
- Check whether there's a tab, "Show more," or anchor link to click that reveals the section, and click it, then re-read.
- If the page is long, scroll toward where the missing content should logically be (near a count/summary that hints at it) and re-read — content genuinely can be present in the DOM only after that scroll position is reached.
- Only conclude a section is genuinely absent after you've tried the applicable one of these, not on the strength of a single top-of-page read.
- After any scroll or tab-click, treat prior refs as stale and take a fresh read, same as after any other page-changing action.

## Corroboration discipline (the step people skip)
Before you write a single fact into your answer, ask: *have I actually opened a second independent source for this, or am I about to report from memory of one page?* Concretely:
- After opening your first promising source, deliberately open at least one more before drafting any claim that's numeric, time-sensitive, or contested — don't draft the answer and "check it later"; check first.
- If your second source agrees, you're likely done for that specific claim (unless stakes call for a third — see thresholds above). If it disagrees, that disagreement is itself a signal to open a third source to adjudicate, not to just pick whichever you saw first or whichever sounds more confident.
- Keep a running mental (or, on a big job, written — see below) list of "claim → which sources actually support it" so you don't lose track of what's been corroborated versus what's still resting on one page.
- Note in your final answer when sources genuinely disagree and couldn't be resolved — this is a better outcome than silently picking one, and it's honest about the state of the evidence.

## Scaling to bigger jobs — fuse with planner and long-task-efficiency
A "research the competitive landscape," "write a report on X," or "compare these five options across these six dimensions" job is not a few-source job — it's a many-source job that needs the same discipline as any other large task:
- **Use the planner skill's todo list** to break the research into concrete, checkable sub-questions (one sub-question or comparison-cell = one task) before opening a single browser tab. This is what keeps a long research session honest — you can always answer "what's actually been corroborated so far and what's still open" by checking the list, rather than trying to hold it all in your head across dozens of page opens.
- **Apply big-task's core rule**: don't respond to "this needs a lot of sources" by doing three sources and writing "you could look into the rest yourself." If the job calls for checking ten items, check ten items, not three plus a note that the pattern generalizes.
- **Apply long-task-efficiency's discipline** on a long research session specifically: reuse one browser session across a whole line of inquiry rather than opening a new one per page; don't re-open a source you've already read and corroborated unless something suggests it may have changed; batch independent lookups (e.g. researching five unrelated companies for a comparison) rather than fully context-switching prose between every single one; checkpoint sub-question-by-sub-question in the todo list so an interrupted session resumes cheaply instead of re-researching from scratch.
- **Report progress honestly on long jobs**: if asked for status mid-research, say what's actually been corroborated, what's been opened but not yet cross-checked, and what hasn't been touched yet — not an optimistic gloss.

## Handling obstacles (quick reference)
- **Bot checks / CAPTCHA / login walls**: don't try to solve them. Abandon that source immediately and pick a different result.
- **Slow-loading or JS-heavy pages**: wait, check network status again, then read — don't mistake a loading spinner for "no results."
- **Empty or broken-looking pages**: check console output for errors before concluding the page has nothing useful; a broken script isn't the same as an empty page.
- **Ambiguous or conflicting information across sources**: don't average or guess — open one or two more sources specifically to resolve the conflict, and note the disagreement in your answer if it can't be resolved.

## Standards for a finished answer
- Never fabricate a URL, a search result, a page's contents, or a quote. Everything reported must come from a page you actually opened and read.
- Never present an answer built from a single opened source as if it were fully corroborated — if you genuinely could only find one source after real effort, say so plainly ("I could only find this stated in one place") rather than implying broader confirmation than you actually have.
- Prefer answers backed by multiple independently-opened sources over a single page, especially for anything numeric, time-sensitive, or contested.
- If, after a reasonable number of attempts, good sources can't be found or loaded, say so plainly rather than presenting a thin or single-source answer with unwarranted confidence.
`
});

export default ResearchSkill;