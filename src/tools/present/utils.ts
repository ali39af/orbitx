import { join } from "path";
import { mkdir, readdir, stat } from "fs/promises";

/**
 * Resolves the folder every "present" file lives in. Configurable via
 * PRESENT_PATH so a host application can redirect it (e.g. into a folder a
 * frontend is already serving); otherwise defaults to <cwd>/data/present.
 */
export function getPresentFolder(): string {
    return process.env.PRESENT_PATH || join(process.cwd(), "data", "present");
}

/** Ensures the present folder exists on disk and returns its path. */
export async function ensurePresentFolder(): Promise<string> {
    const folder = getPresentFolder();
    await mkdir(folder, { recursive: true });
    return folder;
}

/** Lists the absolute paths of every file currently sitting in the present folder (top level only — presents are always files, never folders). */
export async function listPresentFiles(): Promise<string[]> {
    const folder = await ensurePresentFolder();
    const dirents = await readdir(folder, { withFileTypes: true });

    const paths: string[] = [];
    for (const d of dirents) {
        // Defensive: presents are only ever added as files (fs-copy of a
        // single file), but if something else ever puts a directory in
        // here, don't surface it as a presentable item.
        if (d.isFile()) {
            paths.push(join(folder, d.name));
        }
    }
    return paths;
}

export async function fileSize(path: string): Promise<number | undefined> {
    try {
        return (await stat(path)).size;
    } catch {
        return undefined;
    }
}
