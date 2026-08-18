import { readdir, stat } from "fs/promises";
import { join } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { FsInteraction } from "./interaction.js";
import { resolvePath } from "./utils.js";

const DEFAULT_EXCLUDED_DIRS = [
    "node_modules",
    ".git",
    ".next",
    ".turbo",
    "dist",
    "build",
    ".cache",
    "coverage",
    ".vscode",
    ".idea",
];

interface Entry {
    name: string;
    path: string;
    type: "directory" | "symlink" | "file";
    size?: number;
    excluded?: boolean;
}

async function walk(
    dirPath: string,
    recursive: boolean,
    excludeSet: Set<string>,
    depth = 0
): Promise<Entry[]> {
    const dirents = await readdir(dirPath, { withFileTypes: true });

    const results: Entry[] = [];

    for (const d of dirents) {
        const entryPath = join(dirPath, d.name);
        const isDirectory = d.isDirectory();
        const isExcluded = isDirectory && excludeSet.has(d.name);

        let size: number | undefined;
        if (d.isFile()) {
            try {
                size = (await stat(entryPath)).size;
            } catch {
                size = undefined;
            }
        }

        const entry: Entry = {
            name: d.name,
            path: entryPath,
            type: isDirectory ? "directory" : d.isSymbolicLink() ? "symlink" : "file",
            size,
            ...(isExcluded ? { excluded: true } : {}),
        };

        results.push(entry);

        if (recursive && isDirectory && !isExcluded) {
            const children = await walk(entryPath, recursive, excludeSet, depth + 1);
            results.push(...children);
        }
    }

    return results;
}

export const FsListDirTool = () => new MCPTool<FsInteraction>({
    name: "fs-list-dir",
    description:
        "list the entries (files and directories) inside a directory, optionally paging through the results by entry index so very large directories (especially with recursive: true) never need to be returned in one shot. certain directories (node_modules, .git, etc) are excluded from recursion by default via excludeDirs",
    inputs: [
        {
            name: "path",
            type: "string",
            description: "absolute or cwd-relative path to the directory",
            required: true,
        },
        {
            name: "recursive",
            type: "boolean",
            description: "recurse into subdirectories",
            required: false,
            default: false,
        },
        {
            name: "excludeDirs",
            type: "array",
            description:
                "directory names to exclude from recursive traversal (their contents are skipped, but the directory itself still appears as an entry tagged 'excluded: true'). only applies when recursive is true",
            required: false,
            default: DEFAULT_EXCLUDED_DIRS,
        },
        {
            name: "offsetResult",
            type: "number",
            description: "entry offset to start listing from (for paging through large directories)",
            required: false,
            default: 0,
        },
        {
            name: "limitResult",
            type: "number",
            description: "max number of entries to return",
            required: false,
            default: 500,
        },
    ],
    customClass: new FsInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: MCP,
        customClass?: FsInteraction
    ): Promise<any> => {
        const {
            path,
            recursive = false,
            excludeDirs = DEFAULT_EXCLUDED_DIRS,
            offsetResult = 0,
            limitResult = 500,
        } = inputs;

        const fullPath = resolvePath(path);

        customClass?.emitFsEvent({ type: "listing", path: fullPath });

        const excludeSet = new Set<string>(excludeDirs);

        let entries: Entry[];
        try {
            entries = recursive
                ? await walk(fullPath, true, excludeSet)
                : await walk(fullPath, false, excludeSet);
        } catch (err: any) {
            if (err.code === "ENOENT") throw new Error(`no directory found at "${path}"`);
            if (err.code === "ENOTDIR") throw new Error(`"${path}" is a file, not a directory`);
            throw err;
        }

        const totalResult = entries.length;
        const start = Math.max(0, Math.min(offsetResult, totalResult));
        const end = Math.max(start, Math.min(start + limitResult, totalResult));
        const page = entries.slice(start, end);

        return {
            result: page,
            total: totalResult,
            totalResult,
            offsetResult: start,
            limitResult,
        };
    },
});

export default FsListDirTool;