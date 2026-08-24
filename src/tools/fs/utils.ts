import { resolve } from "path";

/**
 * Normalizes a user/agent supplied path to an absolute path. Relative paths
 * are resolved against process.cwd() so agent-provided paths behave the same
 * regardless of where the host process was started from.
 */
export function resolvePath(path: string): string {
    if (!path || typeof path !== "string") {
        throw new Error("path must be a non-empty string");
    }
    return resolve(process.cwd(), path);
}

/** Splits text into lines the same way across every fs tool (handles \r\n). */
export function toLines(content: string): string[] {
    return content.split(/\r\n|\r|\n/);
}

/**
 * Slices an array of lines by offset/limit, clamping to bounds, and returns
 * both the slice and the total line count so callers can page through large
 * files without ever loading the whole thing into a response.
 *
 * `offsetLine` is 1-indexed (the first line of the file is line 1), matching
 * the convention every fs tool that talks about line numbers uses — this is
 * what LLMs already expect from editors/`cat -n`, and keeping it consistent
 * with `fs-edit-file`'s `offsetLine` is the whole point: a line number read
 * here can be pasted straight into an edit call without an off-by-one.
 * `startLine`/`endLine` in the result are 1-indexed and inclusive.
 */
export function paginateLines(lines: string[], offsetLine: number, limitLine: number) {
    const totalLines = lines.length;
    const start = Math.max(0, Math.min(offsetLine - 1, totalLines));
    const end = Math.max(start, Math.min(start + limitLine, totalLines));
    return {
        content: lines.slice(start, end).join("\n"),
        totalLines,
        startLine: start + 1,
        endLine: end,
    };
}
