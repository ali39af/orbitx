import puppeteer, { Browser } from "puppeteer-core";
import os from "os";
import MCPTool from "../../core/mcp";

export const ReadWebPageTool = new MCPTool({
    name: "read-web-page",
    description: "Retrieve and extract content from a specific URL. Use this when you need to read a webpage's HTML or convert it to clean markdown text. Ideal for reading articles, documentation, API responses, or any web content. Returns structured text without navigation menus or scripts.",
    inputs: [{
        name: "url",
        type: "string",
        description: `Complete URL including protocol (http:// or https://). Example: "https://example.com/page"`,
        required: true,
    },
    {
        name: "outputType",
        type: "string",
        description: `Output format: "text" returns clean markdown-formatted content without HTML tags (best for reading articles and text), "html" returns raw HTML source (use for debugging or when structure matters)`,
        required: true,
    }],
    execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
        let browser: Browser | undefined;
        try {
            const url = inputs.url;
            const outputType = inputs.outputType;
            const maxWords = 5000;

            if (!url || typeof url !== "string") {
                throw new Error("Invalid parameter: 'url' must be a non-empty string like 'https://example.com'");
            }

            if (!url.match(/^https?:\/\//i)) {
                throw new Error("Invalid URL format: URL must start with http:// or https://");
            }

            if (!outputType || typeof outputType !== "string") {
                throw new Error("Invalid parameter: 'outputType' must be specified as either 'text' or 'html'");
            }

            if (outputType !== "text" && outputType !== "html") {
                throw new Error(`Invalid outputType '${outputType}': must be 'text' or 'html'`);
            }

            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH || (os.platform() == "win32" ?
                    "C:/Program Files/Google/Chrome/Application/chrome.exe" :
                    "/usr/bin/google-chrome-stable"),
                headless: true,
                args: ["--no-sandbox"],
            });

            const page = await browser.newPage();

            await page.evaluateOnNewDocument(() => {
                (window as any).__name = (fn: Function, _name: string) => fn;
            });

            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            );
            await page.goto(url, { waitUntil: "networkidle0", timeout: 50000 });

            if (outputType === "html") {
                return await page.content();
            }

            const extracted = await page.evaluate(() => {
                const getInnerText = (el: Element): string => {
                    if (el instanceof HTMLElement) return el.innerText.trim();
                    return el.textContent?.trim() || "";
                };

                const garbageSelectors = [
                    "script", "style", "noscript", "iframe", "svg", "canvas",
                    "nav", "footer", "header", "aside",
                    ".sidebar", ".toc", ".menu", ".navigation", ".breadcrumb",
                    ".advertisement", ".ads", ".popup", ".modal",
                    ".feedback", ".rating", ".comment", ".social-share", ".share",
                    ".social", ".related", ".recommended", ".popular", ".trending",
                    ".footer-links", ".copyright", ".privacy", ".terms", ".cookie",
                    ".consent", ".newsletter", ".subscribe", ".email-signup",
                    ".download", ".app-promo", ".widget", ".right-rail", ".left-rail",
                    ".sticky", ".floating", ".popover", ".tooltip", ".dropdown-menu",
                    ".search", ".filter", ".sort", ".pagination", ".author-bio",
                    ".meta", ".timestamp", ".category", ".tags", ".breadcrumb",
                    ".video-player", ".audio-player", ".slider", ".carousel", ".tabs",
                    ".accordion", ".collapse", ".toggle", ".share-buttons", ".print",
                    ".pdf", ".download-link", ".external-link", ".like", ".vote",
                    ".rating-stars", ".review", ".testimonial", ".footnote",
                    ".reference", ".citation", ".table-of-contents", ".summary",
                    ".abstract", ".excerpt", ".teaser", ".preview", ".thumbnail",
                    ".avatar", ".profile", ".user", ".comment-author", ".comment-content",
                    ".reply", ".thread", ".discussion", ".forum", ".chat-message",
                    ".notification", ".alert", ".warning", ".error", ".success", ".info",
                    ".banner", ".hero", ".jumbotron", ".cta", ".call-to-action",
                    ".button-wrapper", ".btn-group", ".toolbar", ".controls",
                    ".settings", ".preferences", ".language-selector", ".back-to-top",
                    ".scroll-to-top", ".share-this", ".bookmark", ".favorite",
                    ".poll", ".survey", ".quiz", ".load-more", ".infinite-scroll",
                    ".spinner", ".loader", ".progress", ".visually-hidden", ".sr-only",
                    "[role='navigation']", "[role='banner']", "[role='complementary']",
                    "[aria-hidden='true']", ".ask-bloom", ".chat-widget", ".support-widget"
                ];
                garbageSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => el.remove());
                });

                document.querySelectorAll("div, section, article").forEach(el => {
                    if (!(el instanceof HTMLElement)) return;
                    const text = el.innerText.trim();
                    if (!text.length) return;
                    const links = el.querySelectorAll("a");
                    let linkTextLength = 0;
                    links.forEach(link => {
                        if (link instanceof HTMLElement) linkTextLength += link.innerText.length;
                    });
                    if (linkTextLength / text.length > 0.7) {
                        el.remove();
                    }
                });

                let mainContent: Element | null = null;

                const candidates = [
                    document.querySelector("main"),
                    document.querySelector("article"),
                    document.querySelector("[role='main']"),
                    document.querySelector(".main-content"),
                    document.querySelector(".content"),
                    document.querySelector(".post-content"),
                    document.querySelector(".prose"),
                    document.querySelector("#content"),
                    document.querySelector(".post"),
                    document.querySelector(".entry"),
                    document.querySelector(".article-content"),
                    document.querySelector(".story"),
                    document.querySelector(".body"),
                    document.querySelector(".primary"),
                    document.querySelector(".main"),
                    document.querySelector(".column-main"),
                    document.querySelector(".region-main"),
                    document.querySelector(".node-content"),
                    document.querySelector(".field-name-body"),
                    document.querySelector(".body-field"),
                    document.querySelector(".page-content"),
                    document.querySelector(".post-body"),
                    document.querySelector(".entry-content"),
                    document.querySelector(".article-body"),
                    document.querySelector(".blog-post"),
                    document.querySelector(".single-post"),
                    document.querySelector(".main-text"),
                    document.querySelector(".primary-content"),
                    document.querySelector(".content-area"),
                    document.querySelector(".site-content"),
                ];

                for (const candidate of candidates) {
                    if (candidate && getInnerText(candidate).length > 300) {
                        mainContent = candidate;
                        break;
                    }
                }

                if (!mainContent) {
                    let maxTextLen = 0;
                    let bestEl: Element | null = null;
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_ELEMENT,
                        {
                            acceptNode: (node) => {
                                const el = node as Element;
                                const tag = el.tagName.toLowerCase();
                                if (["div", "section", "article", "main"].includes(tag)) {
                                    return NodeFilter.FILTER_ACCEPT;
                                }
                                return NodeFilter.FILTER_SKIP;
                            }
                        }
                    );
                    while (walker.nextNode()) {
                        const el = walker.currentNode as Element;
                        const textLen = getInnerText(el).length;
                        if (textLen > maxTextLen && textLen > 500) {
                            maxTextLen = textLen;
                            bestEl = el;
                        }
                    }
                    mainContent = bestEl;
                }

                if (!mainContent) {
                    mainContent = document.body;
                    document.querySelectorAll("aside, .sidebar, nav, footer, header").forEach(el => el.remove());
                }

                function nodeToMd(node: Node, depth = 0): string {
                    if (node.nodeType === 3) {
                        return (node.textContent || "").replace(/\s+/g, " ");
                    }
                    if (node.nodeType !== 1) return "";

                    const el = node as Element;
                    const tag = el.tagName.toLowerCase();

                    if (el instanceof HTMLElement) {
                        const style = window.getComputedStyle(el);
                        if (style.display === "none" || style.visibility === "hidden") return "";
                    }

                    const children = () => Array.from(el.childNodes).map(n => nodeToMd(n, depth)).join("");

                    if (tag === "h1") return `\n\n# ${children().trim()}\n\n`;
                    if (tag === "h2") return `\n\n## ${children().trim()}\n\n`;
                    if (tag === "h3") return `\n\n### ${children().trim()}\n\n`;
                    if (tag === "h4") return `\n\n#### ${children().trim()}\n\n`;
                    if (tag === "h5") return `\n\n##### ${children().trim()}\n\n`;
                    if (tag === "h6") return `\n\n###### ${children().trim()}\n\n`;

                    if (tag === "br") return "\n";
                    if (tag === "hr") return "\n\n---\n\n";

                    if (["p", "div", "section", "article"].includes(tag)) {
                        const inner = children().trim();
                        return inner ? `\n\n${inner}\n\n` : "";
                    }

                    if (tag === "a") {
                        const anchor = el as HTMLAnchorElement;
                        const href = anchor.href;
                        const text = children().trim();
                        if (!text) return "";
                        if (href.startsWith("#")) return text;
                        if (href.startsWith("javascript:")) return text;
                        if (href && href !== text && text.length > 0) return `[${text}](${href})`;
                        return text;
                    }

                    if (tag === "img") {
                        const img = el as HTMLImageElement;
                        const alt = img.alt?.trim() || "";
                        const src = img.src;
                        if (!src || src.startsWith("data:")) return alt || "";
                        return alt ? `![${alt}](${src})` : `![](${src})`;
                    }

                    if (["strong", "b"].includes(tag)) {
                        const inner = children().trim();
                        return inner ? `**${inner}**` : "";
                    }
                    if (["em", "i"].includes(tag)) {
                        const inner = children().trim();
                        return inner ? `*${inner}*` : "";
                    }
                    if (tag === "code") {
                        const inner = children().trim();
                        return inner ? `\`${inner}\`` : "";
                    }
                    if (tag === "pre") {
                        const codeEl = el.querySelector("code");
                        const lang = codeEl?.className.match(/language-(\w+)/)?.[1] || "";
                        const text = (codeEl || el).textContent?.trim() || "";
                        return text ? `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n` : "";
                    }

                    if (tag === "blockquote") {
                        const inner = children().trim();
                        if (!inner) return "";
                        return "\n\n" + inner.split("\n").map(l => `> ${l}`).join("\n") + "\n\n";
                    }

                    if (tag === "ul") {
                        const items = Array.from(el.children)
                            .filter(c => c.tagName.toLowerCase() === "li")
                            .map(li => {
                                const text = nodeToMd(li, depth + 1).trim();
                                const indent = "  ".repeat(depth);
                                return `${indent}- ${text}`;
                            });
                        return items.length ? `\n\n${items.join("\n")}\n\n` : "";
                    }
                    if (tag === "ol") {
                        const items = Array.from(el.children)
                            .filter(c => c.tagName.toLowerCase() === "li")
                            .map((li, i) => {
                                const text = nodeToMd(li, depth + 1).trim();
                                const indent = "  ".repeat(depth);
                                return `${indent}${i + 1}. ${text}`;
                            });
                        return items.length ? `\n\n${items.join("\n")}\n\n` : "";
                    }
                    if (tag === "li") return children();

                    if (tag === "table") {
                        const rows = Array.from(el.querySelectorAll("tr"));
                        if (rows.length === 0) return "";
                        const toRow = (row: Element) =>
                            Array.from(row.querySelectorAll("th,td"))
                                .map(cell => cell.textContent?.replace(/\s+/g, " ").trim() || "")
                                .join(" | ");
                        const firstRow = rows[0];
                        if (!firstRow) return "";
                        const isHeaderRow = firstRow.querySelectorAll("th").length > 0;
                        const headerText = toRow(firstRow);
                        const cols = firstRow.querySelectorAll("th,td").length;
                        if (cols === 0) return "";
                        const separator = Array(cols).fill("---").join(" | ");
                        const dataRows = isHeaderRow ? rows.slice(1) : rows;
                        const bodyLines = dataRows.map(r => `| ${toRow(r)} |`).join("\n");
                        return `\n\n| ${headerText} |\n| ${separator} |\n${bodyLines}\n\n`;
                    }

                    return children();
                }

                let md = nodeToMd(mainContent);

                md = md.replace(/\n{3,}/g, "\n\n");
                md = md.replace(/[ \t]+$/gm, "");
                md = md.trim();

                return md;
            });

            let output = `# Source: ${url}\n\n${extracted}`;

            const words = output.split(/\s+/);
            if (words.length > maxWords) {
                return words.slice(0, maxWords).join(" ") +
                    `\n\n---\n*Truncated: ${words.length} words → ${maxWords} words*`;
            }

            if (!output) {
                throw new Error(`Failed to fetch content from ${url} - received empty response`);
            }

            return {
                content: output,
                size: output.length
            };
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            await browser?.close();
        }
    }
});

export default ReadWebPageTool;