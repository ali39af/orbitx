import { test, describe } from "node:test";

/**
 * Browser tool tests are pending — a codebase issue, not a test-writing one.
 * `npm test` runs via tsx (not a `tsc` build), and tsx/esbuild wraps every
 * nested named function/arrow with a `__name(fn, "name")` helper. Puppeteer's
 * page.evaluate() serializes its callback via Function.prototype.toString()
 * and runs the source inside an isolated browser context that has no access
 * to that helper, so any evaluate() callback carrying a leaked `__name(...)`
 * call throws `ReferenceError: __name is not defined` inside the page. See
 * src/tools/browser/evaluate-safe.ts for the existing (partial) workaround —
 * not every browser tool's page.evaluate() call goes through it yet, so
 * real tests here would fail on tsx even though the tools work fine from a
 * compiled `tsc` build. These are left as node:test TODOs (not
 * skipped/deleted) so the gap stays visible in `npm test` output until
 * that's sorted out and real tests get written, following the same
 * MCPClient/MCPServer/MCPConnection pattern used by every other tools/*
 * test (see src/tests/tools/utils/delay.test.ts).
 */
describe("browser (pending — puppeteer issue)", () => {
    test.todo("BrowserCreateSessionTool: opens a session at a url and returns a sessionId");
    test.todo("BrowserRemoveSessionTool: closes a session and removes it from browser-get-sessions");
    test.todo("BrowserGetSessionsTool: reflects open sessions and stops listing removed ones");
    test.todo("BrowserNavigateTool: navigates an existing session to a new url");
    test.todo("BrowserConsoleTool: captures console messages logged by the page");
    test.todo("BrowserInjectTool: evaluates javascript in the page and returns its result");
    test.todo("BrowserReadTool: outlines the page and tags interactive elements with ref ids, paginates via continueRef");
    test.todo("BrowserClickTool: clicks a clickable element by ref");
    test.todo("BrowserFillTool: types into a fillable element by ref, including submitOnEnter for forms with no submit button");
    test.todo("BrowserSubmitFormTool: submits a form by its form ref");
    test.todo("BrowserScrollInfoTool: reports scrollable length and current scroll position");
    test.todo("BrowserScrollTool: scrolls the page to a given vertical position");
    test.todo("BrowserNetworkStatusTool: reports idle/loading network status");
    test.todo("BrowserNetworkTool: logs network requests, filterable by resource type");
    test.todo("BrowserScreenshotTool: returns an image tool-output (viewport and fullPage)");
});
