import os from "os";
import puppeteer from "puppeteer-core";
import MCPTool from "../../core/mcp.js";

export const WebSearchTool = new MCPTool({
    name: "web-search",
    description: "Search the web for information, news, or resources. Returns titles, snippets, and URLs.",
    inputs: [{
        name: "query",
        type: "string",
        description: `Search term or phrase (e.g., "climate change effects", "Python tutorials")`,
        required: true,
    }],
    execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
        try {
            const query = inputs.query;

            if (!query || typeof query !== "string") {
                throw new Error(`Invalid parameter: "query" must be a non-empty search query string`);
            }

            const cleanedQuery = query.trim();

            if (cleanedQuery.length === 0) {
                throw new Error(`Invalid parameter: "query" cannot be empty or just whitespace`);
            }

            if (cleanedQuery.length > 500) {
                throw new Error(`Search query is quite long (${cleanedQuery.length} chars). Consider shortening for better results.`);
            }

            const browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH || (os.platform() == "win32" ?
                    "C:/Program Files/Google/Chrome/Application/chrome.exe" :
                    "/usr/bin/google-chrome-stable"),
                headless: false,
                args: ["--no-sandbox"],
            });

            const page = await browser.newPage();

            await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

            await page.goto(
                `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
                { waitUntil: "networkidle0", timeout: 30000 }
            );

            await page.waitForSelector(".result", { timeout: 10000 });

            const results = await page.evaluate(() => {
                const resultElements = document.querySelectorAll(".result");

                return Array.from(resultElements).map((el, i) => {
                    const titleElement = el.querySelector(".result__a, .result-title, a.result__url");
                    const title = titleElement?.textContent?.trim() || "";

                    let url = "";
                    const linkElement = titleElement as HTMLAnchorElement;
                    if (linkElement?.href) {
                        url = linkElement.href;
                        try {
                            const urlParams = new URLSearchParams(linkElement.href.split("?")[1]);
                            const uddg = urlParams.get("uddg");
                            if (uddg) {
                                url = decodeURIComponent(uddg);
                            }
                        } catch (e) { }
                    }

                    const snippetElement = el.querySelector(".result__snippet, .result-snippet, .snippet");
                    const snippet = snippetElement?.textContent?.trim() || "";

                    return {
                        title,
                        url,
                        snippet,
                    };
                }).filter((r) => r.title && r.url && r.url.startsWith("http"));
            });

            await browser.close();

            if (results.length === 0) {
                console.log("No results found for:", query);
                return [];
            }

            if (!results || (Array.isArray(results) && results.length === 0)) {
                throw new Error(`No results found for your search query`);
            }

            return results;
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
});

export default WebSearchTool;