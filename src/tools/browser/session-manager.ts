import os from "os";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

export interface ConsoleLogEntry {
    type: string;
    content: string;
}

export interface NetworkLogEntry {
    type: string;
    status: number;
    requestHeaders: Record<string, string>;
    request: string;
    responseHeaders: Record<string, string>;
    response: string;
}

const CONSOLE_LOG_CAP = 1000;
const NETWORK_LOG_CAP = 1000;
const MAX_LOG_ENTRIES = 500;

/**
 * Holds everything tied to one live browser session: the Puppeteer browser
 * and page, plus the ref-id map used so the AI can refer to clickable /
 * fillable elements by a stable short hex id instead of re-describing them.
 */
class BrowserSession {
    id: string;
    browser: Browser;
    page: Page;
    consoleLogs: ConsoleLogEntry[] = [];
    networkLogs: NetworkLogEntry[] = [];

    constructor(id: string, browser: Browser, page: Page) {
        this.id = id;
        this.browser = browser;
        this.page = page;
    }

    pushConsoleLog(entry: ConsoleLogEntry) {
        this.consoleLogs.push(entry);
        if (this.consoleLogs.length > MAX_LOG_ENTRIES) {
            this.consoleLogs.splice(0, this.consoleLogs.length - MAX_LOG_ENTRIES);
        }
    }

    pushNetworkLog(entry: NetworkLogEntry) {
        this.networkLogs.push(entry);
        if (this.networkLogs.length > MAX_LOG_ENTRIES) {
            this.networkLogs.splice(0, this.networkLogs.length - MAX_LOG_ENTRIES);
        }
    }
}

const sessions: Map<string, BrowserSession> = new Map();

function truncate(str: string, cap: number): string {
    return str.length > cap ? str.slice(0, cap) : str;
}

export async function createSession(url: string, sessionId: string): Promise<BrowserSession> {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_PATH || (os.platform() == "win32" ?
            "C:/Program Files/Google/Chrome/Application/chrome.exe" :
            "/usr/bin/google-chrome-stable"),
        headless: Boolean(process.env.HEADLESS_BROWSER_SESSIONS || true),
        args: ["--no-sandbox"],
    });

    const page = await browser.newPage();

    const session = new BrowserSession(sessionId, browser, page);

    page.on("console", (msg) => {
        session.pushConsoleLog({
            type: msg.type(),
            content: truncate(msg.text(), CONSOLE_LOG_CAP),
        });
    });

    page.on("response", async (response) => {
        try {
            const request = response.request();
            let responseBody = "";
            try {
                responseBody = await response.text();
            } catch {
                responseBody = "";
            }

            session.pushNetworkLog({
                type: request.resourceType(),
                status: response.status(),
                requestHeaders: request.headers(),
                request: truncate(request.postData() || request.url(), NETWORK_LOG_CAP),
                responseHeaders: response.headers(),
                response: truncate(responseBody, NETWORK_LOG_CAP),
            });
        } catch {
            // best-effort logging only, never throw from an event handler
        }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });

    sessions.set(sessionId, session);

    return session;
}

export function getSession(sessionId: string): BrowserSession {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error(`no browser session found with id "${sessionId}"`);
    }
    return session;
}

export function getSessionIds(): string[] {
    return Array.from(sessions.keys());
}

export async function removeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    await session.browser.close().catch(() => { });
    sessions.delete(sessionId);
}

export default BrowserSession;
export { BrowserSession };
