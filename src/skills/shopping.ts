import Skill from "../core/skill.js";
import { BrowserTools } from "../tools/browser/index.js";
import { UtilTools } from "../tools/utils/index.js";

export const ShoppingSkill = () => new Skill({
    name: "shopping",
    description: "Use this skill whenever the user wants help choosing, comparing, or buying a product — 'what's the best X', 'help me find a Y', 'is this a good deal', 'which should I buy', or a request for a specific product recommendation. Drives a real browser to find actual current listings, actual prices, actual direct links, and actual reviews — never recommends from memory or general reputation alone, since prices, models, and availability change constantly. Covers finding and comparing multiple competing options (not just one), surfacing real customer review sentiment (including scrolling to load reviews sections that don't render on initial page load), and giving the user a direct link and price for anything recommended. Trigger this for purchase-decision questions specifically; for general product knowledge questions with no purchase intent ('how does a HEPA filter work'), this skill isn't needed.",
    tools: [
        ...BrowserTools(),
        ...UtilTools()
    ],
    instructions: `
# Shopping Skill

## Mindset
Product recommendations go stale immediately — prices change daily, models get discontinued, "best" lists from training data are often already wrong by the time they're read back. Never recommend a specific product from memory or general brand reputation alone. Every specific product named in a shopping answer needs: a real, currently-open listing, a real current price, a real direct link, and — where the decision is non-trivial — real review evidence actually read from the page, not inferred from the product's category or brand alone.

The job is not "name a good product." The job is "help the user actually buy the right thing" — which means giving them a link they can click, a price they can trust as current, and enough comparative context (competitors, review sentiment, actual tradeoffs) that they're not making the decision on vibes.

## Core loop
1. Open a browser session (DuckDuckGo or Bing as entry point — not Google, same reasoning as the research skill: it blocks headless browsers). If the user named a specific retailer/site, go straight there instead.
2. Search for the product category, read the results outline, and open several promising, genuinely different listings — not five results from the same retailer, and not just the first result.
3. On each listing page, actually read: the current price, the product's real name/model, and whether it's in stock — don't report a price you haven't actually seen rendered on the page in this session, since cached/remembered prices are routinely wrong.
4. Get the actual review section loaded and read (see "Reviews" below) rather than trusting a star rating alone.
5. Repeat for at least 2–3 genuinely competing products before making a recommendation — see "Never recommend just one option" below.
6. Present the comparison with direct links and current prices for everything named.

## Never recommend just one option
A shopping answer that names a single product with no comparison is not doing the job, even if that product happens to be great. Unless the user has already narrowed to one specific item and just wants a check on it, always surface competitors:
- Open listings for at least 2–3 realistic alternatives in the same category/price band, not just variations of the same brand.
- Compare on the dimensions that actually matter for the category (price, key specs, review sentiment, warranty/return policy) rather than an arbitrary feature list.
- Be explicit about tradeoffs — "A is cheaper but has weaker reviews on durability; B costs more but consistently gets praised for X" — rather than a flat ranked list with no reasoning shown.
- If the user's ask is narrow ("is this specific product good") rather than "what should I buy," you can lead with a direct answer about that product, but still mention how it stacks up against its obvious alternatives rather than evaluating it in isolation.

## Prices and links — accuracy is the whole point
- Every price quoted must be one you actually observed rendered on the page during this session. Prices from memory, from a search snippet alone, or extrapolated from an old listing are not acceptable — retailers change prices constantly and a stale number actively misleads a purchase decision.
- Always give the user the actual URL you found the listing at, not a guessed or reconstructed URL — only link to pages you actually opened and read in this session (never fabricate a plausible-looking product URL).
- Note the currency and, if relevant to the user's likely location, flag if a price appears to be in a different currency/region than expected.
- If a price shown seems to be a temporary sale/limited-time deal, say so — don't present a flash-sale price as the item's normal price.
- If stock status is visible (in stock / limited stock / out of stock / backordered), report it — a great deal on an out-of-stock item isn't actionable.
- If prices differ noticeably across retailers for what's genuinely the same item, surface the cheapest legitimate option rather than defaulting to whichever site you happened to open first.

## Reviews — read them, don't infer them
A star rating alone is weak evidence — 4.2 stars can mean "consistently solid" or "half the reviews say it broke in a month and half say it's great," and those are very different signals for a buyer. Actually read review content:
- **Reviews sections often don't render on initial page load.** Many e-commerce and retailer sites lazy-load the reviews section only once it's scrolled into view, or require clicking a "Reviews" tab/anchor link separately from the main product description. If you read a page and don't see review text (even though a star rating and review count are shown near the top), don't conclude there are no reviews — check whether there's a "Reviews" tab/link to click, and if the page is long, scroll down toward where a review count was shown and re-read, since that section may only populate once it's in view. This is a common trap: an agent that reads only the top of the page and reports "no reviews shown" when reviews exist further down or behind a tab is giving a false negative.
- After getting the reviews section to actually load, read a real sample — not just the single top-featured/most-helpful review, which retailers sometimes curate. Skim across several individual reviews, and specifically look at a mix of high and low ratings to catch recurring complaints that a single glowing top review would hide.
- Look for *recurring* specific complaints or praise across multiple reviewers (e.g. several independent reviewers mentioning the same durability issue, or the same standout feature) rather than treating one person's review as representative.
- If a retailer's on-page reviews look thin, curated, or suspiciously uniform (all 5-star, generic phrasing, no verified-purchase indication), treat that as lower-confidence evidence and consider checking a second, independent source (a different retailer's listing for the same product, or a review-aggregation/comparison site) rather than relying solely on the first one seen.
- Report review sentiment honestly, including negatives — "mostly positive, but a recurring complaint about X" is more useful and more trustworthy than an uncritical "highly rated" gloss that ignores visible negative signal on the same page.

## Handling pages that need extra interaction to show what you need
Beyond reviews specifically, several other common shopping-page patterns require action before the real content is visible:
- **"Show more" / "See all specs" buttons** that collapse full specifications by default — click through rather than reporting only the abbreviated spec list.
- **Variant selectors** (size, color, storage capacity) that change the displayed price/stock/images when selected — if the user cares about a specific variant, actually select it and re-read rather than reporting the default variant's price as if it applies to all.
- **Comparison tables** on some retailer sites that require selecting products into a "compare" tray before the table renders — worth doing if the user is choosing between options on the same site.
- **Pagination or "load more" on review lists** — if you want a broader review sample than the first page shows, page/load further rather than judging sentiment from only the first handful.
- After any of these interactions, re-read the page — refs and rendered content are stale the moment an interaction changes the DOM, same as any other browser-driven task.

## Handling obstacles
- Bot checks, CAPTCHAs, or hard login walls on a retailer page: don't fight them — abandon that listing and check the same product on a different retailer.
- If a retailer's page is slow/JS-heavy and content (price, reviews) looks like it hasn't finished loading, wait briefly and re-check rather than reading a half-loaded page as final — same discipline as the research skill.
- If you genuinely can't get a real current price or working link for something after reasonable effort, say so plainly rather than presenting a stale or guessed price with unwarranted confidence.

## What a finished shopping answer looks like
- At least 2–3 real, comparable options (unless the user asked about one specific item) with current prices and direct links to what you actually opened.
- Honest review sentiment for each, based on actually-read review content — including scrolling/clicking through to reach reviews that weren't visible on first load — not just a star-rating gloss.
- Clear tradeoffs stated between the options, not just a ranked list with no reasoning.
- Explicit notes on anything time-sensitive (a sale price, limited stock) so the user knows the information's shelf life.
`
});

export default ShoppingSkill;