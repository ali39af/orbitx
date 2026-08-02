import type { Page } from "puppeteer-core";
import { generateRefId, type MCP } from "../../core/mcp.js";
import type { BrowserSession } from "./session-manager.js";

const READABLE_TAGS = new Set([
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "span", "li", "td", "th", "label", "a", "button",
    "input", "textarea", "select", "img",
]);

const CLICKABLE_TAGS = new Set(["a", "button"]);
const FILLABLE_TAGS = new Set(["input", "textarea", "select"]);

interface RawNode {
    tag: string;
    text: string;
    depth: number;
    /** stable index used only to re-select this exact element for ref assignment */
    domIndex: number;
    clickable: boolean;
    fillable: boolean;
    /**
     * domIndex of the nearest ancestor <form> this node lives inside, or
     * undefined if it's not inside a form. Used so the agent can tell when a
     * fillable input has no visible submit button nearby and must be
     * submitted by dispatching the form's submit event instead (the same
     * effect as pressing Enter in the field).
     */
    formIndex?: number;
    /** true only for the form element itself */
    isForm?: boolean;
    /** true if this form has no visible submit-capable button/input inside it */
    formHasNoSubmitButton?: boolean;
}

/**
 * Walks the live DOM in-page and produces a flat, depth-annotated outline of visible text/interactive nodes.
 *
 * IMPORTANT: The function passed to page.evaluate() is serialized via
 * Function.prototype.toString() and executed in an isolated browser
 * context that has NO access to this module's scope. Under esbuild/tsx,
 * nested `function foo() {}` declarations get wrapped with a module-local
 * `__name(foo, "foo")` helper call (for Function.name preservation), and
 * that helper reference leaks into the serialized source, causing
 * `ReferenceError: __name is not defined` inside the page. To avoid this,
 * every helper inside the evaluate() callback below is a `const` arrow
 * function instead of a named function declaration.
 */
async function extractOutline(page: Page): Promise<RawNode[]> {
    return page.evaluate((readableTags: string[], clickableTags: string[], fillableTags: string[]) => {
        const readable = new Set(readableTags);
        const clickable = new Set(clickableTags);
        const fillable = new Set(fillableTags);

        const results: RawNode[] = [];
        let domIndex = 0;

        // assign every <form> on the page a stable index (independent of
        // walk() so it's known before we need to reference it from inputs
        // nested inside it), and figure out up front whether each form has
        // any visible element capable of submitting it.
        const forms = Array.from(document.querySelectorAll("form"));
        const formIndexOf = new Map<Element, number>();
        const formHasSubmit = new Map<number, boolean>();
        forms.forEach((form, i) => {
            formIndexOf.set(form, i);
            const submitEl = form.querySelector(
                'button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"], button[type="submit"]'
            );
            formHasSubmit.set(i, !!submitEl);
        });

        const nearestForm = (el: Element): Element | null => {
            return el.closest("form");
        };

        const isVisible = (el: Element): boolean => {
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };

        const textOf = (el: Element): string => {
            if (el.tagName.toLowerCase() === "img") {
                return el.getAttribute("alt") || "";
            }
            if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
                return (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || "";
            }
            // direct text content only (avoid re-printing children we'll visit separately)
            let text = "";
            for (const child of Array.from(el.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent || "";
                }
            }
            return text.trim();
        };

        const walk = (el: Element, depth: number): void => {
            const currentIndex = domIndex++;
            const tag = el.tagName.toLowerCase();
            const isFormEl = tag === "form";

            if ((readable.has(tag) || isFormEl) && isVisible(el)) {
                const text = isFormEl ? "" : textOf(el);
                const isInteractive = clickable.has(tag) || fillable.has(tag) || !!(el as HTMLElement).onclick;
                if (text || isInteractive || isFormEl) {
                    if (isInteractive || isFormEl) {
                        // Marker attribute lets us re-select this exact element
                        // from outside evaluate() without relying on any
                        // custom global helper surviving across calls.
                        el.setAttribute("data-orbitx-dom-index", String(currentIndex));
                    }

                    const parentForm = fillable.has(tag) || clickable.has(tag) ? nearestForm(el) : null;
                    const parentFormIndex = parentForm ? formIndexOf.get(parentForm) : undefined;

                    results.push({
                        tag,
                        text,
                        depth,
                        domIndex: currentIndex,
                        clickable: clickable.has(tag) || !!(el as HTMLElement).onclick,
                        fillable: fillable.has(tag),
                        formIndex: isFormEl ? formIndexOf.get(el) : parentFormIndex,
                        isForm: isFormEl,
                        formHasNoSubmitButton: isFormEl
                            ? !formHasSubmit.get(formIndexOf.get(el)!)
                            : parentFormIndex !== undefined
                                ? !formHasSubmit.get(parentFormIndex)
                                : undefined,
                    });
                }
            }

            for (const child of Array.from(el.children)) {
                walk(child, depth + (readable.has(tag) || isFormEl ? 1 : 0));
            }
        };

        if (document.body) walk(document.body, 0);

        return results;
    }, Array.from(READABLE_TAGS), Array.from(CLICKABLE_TAGS), Array.from(FILLABLE_TAGS));
}

export interface ReadPageResult {
    content: string;
    totalLines: number;
    /**
     * present only when there are more lines after the returned window;
     * pass it back in as `ref` on the next browser-read call to keep paging
     * through the SAME captured snapshot (no new DOM walk, no new ref ids)
     * instead of re-reading the live page.
     */
    ref?: string;
}

/** Resolves a ref id previously handed out by readPage() back to its live element, or null if it's no longer on the page. */
export async function resolveRef(page: Page, ref: string) {
    return page.$(`[data-orbitx-ref="${ref}"]`);
}

/**
 * Resolves the ref id of the <form> that a given fillable/clickable element
 * ref lives inside, or null if that element isn't inside a form. Used by
 * browser-fill to know whether it should also submit the form after typing
 * (i.e. the form has no visible submit button, so pressing Enter is the
 * only way a real user could submit it).
 */
export async function resolveFormForRef(page: Page, ref: string): Promise<{ formRef: string; hasSubmitButton: boolean } | null> {
    return page.evaluate((r: string) => {
        const el = document.querySelector(`[data-orbitx-ref="${r}"]`);
        if (!el) return null;
        const form = el.closest("form");
        if (!form) return null;
        const formRef = form.getAttribute("data-orbitx-ref");
        if (!formRef) return null;
        const hasSubmitButton = !!form.querySelector(
            'button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"], button[type="submit"]'
        );
        return { formRef, hasSubmitButton };
    }, ref);
}

/** Submits a form via its ref id, the same way a browser does when a lone text field receives Enter. */
export async function submitForm(page: Page, formRef: string): Promise<boolean> {
    return page.evaluate((r: string) => {
        const form = document.querySelector(`[data-orbitx-ref="${r}"]`) as HTMLFormElement | null;
        if (!form) return false;
        if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
        } else {
            form.submit();
        }
        return true;
    }, formRef);
}

const READ_PAGE_STORAGE_PREFIX = "browser-read-page:";

/**
 * Reads the current page into a readable, indented text outline (h1-h6, p,
 * table cells, links, inputs, buttons, images), assigning a fresh unique ref
 * id to every clickable/fillable element so the agent can act on it later
 * via browser-click / browser-fill. Supports pagination via offsetLine/limitLine.
 *
 * The FULL, untruncated outline (every line, not just the requested window)
 * is always saved to MCP storage under a fresh ref id, and that ref id is
 * returned whenever the response was truncated. Passing that ref back in via
 * `continueRef` skips re-walking the live DOM entirely and just pages
 * through the previously captured text — useful once the agent has already
 * read part of a long page and wants the rest without generating new
 * (and therefore mismatched) click/fill ref ids.
 */
export async function readPage(
    mcp: MCP | undefined,
    session: BrowserSession,
    offsetLine: number,
    limitLine: number,
    continueRef?: string
): Promise<ReadPageResult> {
    if (continueRef) {
        const stored = mcp ? await mcp.getStorage().get(READ_PAGE_STORAGE_PREFIX + continueRef) : "";
        if (!stored) {
            throw new Error(`ref "${continueRef}" was not found in storage (it may have expired, or belongs to a different session) — call browser-read without continueRef to take a fresh read of the page`);
        }
        const lines = stored.split("\n");
        const totalLines = lines.length;
        const windowed = lines.slice(offsetLine, offsetLine + limitLine);
        const hasMore = offsetLine + limitLine < totalLines;
        return {
            content: windowed.join("\n"),
            totalLines,
            ref: hasMore ? continueRef : undefined,
        };
    }

    // Clear markers left over from a previous read so this read's domIndex
    // numbering (which restarts at 0 every call) can't collide with them.
    await session.page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll("[data-orbitx-dom-index]"))) {
            el.removeAttribute("data-orbitx-dom-index");
        }
        for (const el of Array.from(document.querySelectorAll("[data-orbitx-ref]"))) {
            el.removeAttribute("data-orbitx-ref");
        }
    });

    const nodes = await extractOutline(session.page);

    const lines: string[] = [];
    const domIndexToRef: Map<number, string> = new Map();
    // one ref per distinct form domIndex, so fillable inputs can report
    // which form they belong to and the agent can submit it directly
    const formIndexToRef: Map<number, string> = new Map();

    for (const node of nodes) {
        if (node.isForm && node.formIndex !== undefined && !formIndexToRef.has(node.formIndex)) {
            const ref = await generateRefId(mcp);
            formIndexToRef.set(node.formIndex, ref);
            domIndexToRef.set(node.domIndex, ref);
        }
    }

    for (const node of nodes) {
        const indent = "  ".repeat(node.depth);
        let suffix = "";

        if (node.isForm) {
            const ref = node.formIndex !== undefined ? formIndexToRef.get(node.formIndex) : undefined;
            suffix = ref ? ` [${ref}] [FORM]${node.formHasNoSubmitButton ? " [NO SUBMIT BUTTON: use browser-submit-form with this ref, or fill+Enter]" : ""}` : "";
            lines.push(`${indent}- form${suffix}`);
            continue;
        }

        if (node.clickable || node.fillable) {
            const ref = await generateRefId(mcp);
            domIndexToRef.set(node.domIndex, ref);
            const formRef = node.formIndex !== undefined ? formIndexToRef.get(node.formIndex) : undefined;
            suffix = ` [${ref}]${node.fillable ? " [FILLABLE]" : ""}${node.clickable ? " [CLICKABLE]" : ""}`;
            if (node.fillable && node.formIndex !== undefined) {
                suffix += node.formHasNoSubmitButton
                    ? ` [inside form ${formRef}, NO SUBMIT BUTTON — submitting this field (e.g. pressing Enter) will submit form ${formRef}]`
                    : ` [inside form ${formRef}]`;
            }
        }

        const label = node.text || "(empty)";
        lines.push(`${indent}- ${node.tag}: ${label}${suffix}`);
    }

    // Stamp every interactive element (and every form) with its ref id
    // (data-orbitx-ref) so browser-click / browser-fill / browser-submit-form
    // can re-select it later purely from the ref string via page.$, without
    // depending on a long-lived ElementHandle (handles can go stale once the
    // DOM changes between tool calls).
    if (domIndexToRef.size > 0) {
        await session.page.evaluate((entries: [number, string][]) => {
            for (const [domIndex, ref] of entries) {
                const el = document.querySelector(`[data-orbitx-dom-index="${domIndex}"]`);
                if (el) {
                    el.setAttribute("data-orbitx-ref", ref);
                }
            }
        }, Array.from(domIndexToRef.entries()));
    }

    const totalLines = lines.length;
    const windowed = lines.slice(offsetLine, offsetLine + limitLine);
    const hasMore = offsetLine + limitLine < totalLines;

    // Always persist the complete, untruncated outline so a later call can
    // page through the rest of it via continueRef without re-walking the
    // DOM (which would hand out a fresh, incompatible set of ref ids).
    let ref: string | undefined;
    if (mcp) {
        ref = await generateRefId(mcp);
        await mcp.getStorage().set(READ_PAGE_STORAGE_PREFIX + ref, lines.join("\n"));
    }

    let content = windowed.join("\n");
    if (hasMore) {
        const remaining = totalLines - (offsetLine + limitLine);
        content += `\n\n[... ${remaining} more line(s) not shown${ref ? ` — call browser-read again with continueRef: "${ref}" and a new offsetLine to keep reading` : ""}]`;
    }

    return {
        content,
        totalLines,
        ref: hasMore ? ref : undefined,
    };
}