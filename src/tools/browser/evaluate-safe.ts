import type { Page } from "puppeteer-core";

/**
 * Strips the `__name(fn, "fn")` wrapper esbuild injects (with keepNames,
 * which tsx/ts-node/esbuild-register enable by default) around every named
 * `const`/`let` function binding in a module, including plain arrow
 * functions like `const walk = (el) => { ... }`.
 *
 * Why this is needed: Puppeteer's page.evaluate(fn, ...args) serializes
 * `fn` via Function.prototype.toString() and runs the resulting source
 * string inside the browser page, which has no access to this module's
 * scope. Under a plain `tsc` build the callback source is untouched and
 * this is a non-issue. But when the consuming project is executed directly
 * with a TS loader (tsx, ts-node/esbuild, bun, vite-node, etc.), esbuild
 * rewrites every nested named function/arrow assigned to a variable into:
 *
 *   const walk = /* @__PURE__ *\/ __name((el) => { ... }, "walk");
 *
 * `__name` only exists as a helper hoisted into that transpiled module's
 * own scope, not inside the isolated page context, so once the callback
 * string is shipped to the page and invoked, referencing `walk` throws
 * `ReferenceError: __name is not defined`.
 *
 * The fix here does not require the consumer to change their loader,
 * tsconfig, or bundler settings, since we control the callback's source at
 * the call site: before serializing, unwrap every `__name(<expr>, "<name>")`
 * back down to the bare `<expr>`, and drop any leftover `__name` helper
 * declaration/import fragments that don't matter once no call sites remain.
 */
function stripNameWrapper(source: string): string {
    let out = source;

    // Iteratively unwrap __name(<expr>, "identifier") -> <expr>.
    // Done in a loop (rather than a single regex pass) because __name calls
    // can be nested when a named function itself contains other named
    // consts, and each pass only safely unwraps the innermost balanced call.
    let changed = true;
    while (changed) {
        changed = false;
        out = out.replace(
            /__name\(((?:[^()]|\([^()]*\))*),\s*"[^"]*"\)/g,
            (_match, inner) => {
                changed = true;
                return inner;
            }
        );
    }

    // Remove the `/* @__PURE__ */` annotations esbuild leaves behind next to
    // the calls we just stripped; harmless to leave but pointless to keep.
    out = out.replace(/\/\*\s*@__PURE__\s*\*\/\s*/g, "");

    return out;
}

/**
 * Drop-in replacement for `page.evaluate(fn, ...args)` that is safe to call
 * from a project run under tsx/ts-node/esbuild as well as a plain `tsc`
 * build. Always use this (instead of page.evaluate directly) for any
 * callback that declares nested named `const`/`let` functions.
 */
export async function evaluateSafe<T, A extends any[]>(
    page: Page,
    fn: (...args: A) => T | Promise<T>,
    ...args: A
): Promise<T> {
    const safeSource = stripNameWrapper(fn.toString());
    // @ts-ignore
    return page.evaluate(
        // @ts-ignore
        (src: string, evalArgs: A) => {
            // eslint-disable-next-line no-eval
            const rebuilt = (0, eval)(`(${src})`);
            return rebuilt(...evalArgs);
        },
        safeSource,
        args
    );
}

export default evaluateSafe;
