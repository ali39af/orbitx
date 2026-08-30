import { execFileSync } from "child_process";
import { getProcess } from "../../../tools/bash/process-manager.js";

/**
 * Test-only hard cleanup for a bash-run process, called from each test
 * file's after() once every test has finished (not a timer inside the
 * spawned script itself).
 *
 * bash-run spawns via a shell wrapper (cmd.exe /c "..." on win32, /bin/bash
 * -c "..." elsewhere). The bash-terminate tool only kills that immediate
 * wrapper process; on win32 that can leave the wrapper's own child (e.g. the
 * `node "script.js"` it launched) running as an orphan holding onto its
 * inherited stdio pipes, which is enough to keep the whole test run from
 * exiting. taskkill's /T flag walks the OS-tracked process tree instead of
 * just the one PID, so it reaps that grandchild too.
 *
 * Reaches into the tool's internal process-manager module directly (not
 * through the public index.ts surface) since this is test-cleanup plumbing,
 * not something the tool itself needs to expose. Safe to call on a
 * processId that's already finished, been removed, or never existed.
 */
export function killProcessTree(processId: string): void {
    let pid: number | undefined;
    try {
        pid = getProcess(processId).child.pid;
    } catch {
        return;
    }
    if (!pid) return;

    try {
        if (process.platform === "win32") {
            execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            process.kill(pid, "SIGKILL");
        }
    } catch {
        // already exited between the lookup and the kill attempt
    }
}

export function killProcessTrees(processIds: string[]): void {
    for (const id of processIds) killProcessTree(id);
}
