import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Small node scripts used as bash-run/bash-wait/etc test subjects, run via
 * `node "<script>"` so tests never depend on shell-quoting differences
 * between cmd.exe (Windows) and /bin/bash (posix).
 */
export interface BashFixtures {
    dir: string;
    echo: string;
    fail: string;
    sleep: string;
    delayedEcho: string;
    stdinEcho: string;
}

export function createBashFixtures(): BashFixtures {
    const dir = mkdtempSync(join(tmpdir(), "orbitx-bash-fixtures-"));

    const echo = join(dir, "echo.js");
    writeFileSync(echo, "console.log('hello from stdout');");

    const fail = join(dir, "fail.js");
    writeFileSync(fail, "process.exit(3);");

    const sleep = join(dir, "sleep.js");
    writeFileSync(sleep, "setTimeout(() => {}, 4000);");

    const delayedEcho = join(dir, "delayed-echo.js");
    writeFileSync(delayedEcho, "setTimeout(() => console.log('done'), 300);");

    const stdinEcho = join(dir, "stdin-echo.js");
    writeFileSync(
        stdinEcho,
        "process.stdin.once('data', (d) => { console.log('got:' + d.toString().trim()); process.exit(0); });" +
        "setTimeout(() => process.exit(0), 4000);"
    );

    return { dir, echo, fail, sleep, delayedEcho, stdinEcho };
}

export function nodeCmd(scriptPath: string): string {
    return `node "${scriptPath}"`;
}
