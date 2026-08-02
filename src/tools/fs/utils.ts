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
 */
export function paginateLines(lines: string[], offsetLine: number, limitLine: number) {
    const totalLines = lines.length;
    const start = Math.max(0, Math.min(offsetLine, totalLines));
    const end = Math.max(start, Math.min(start + limitLine, totalLines));
    return {
        content: lines.slice(start, end).join("\n"),
        totalLines,
        startLine: start,
        endLine: end,
    };
}
