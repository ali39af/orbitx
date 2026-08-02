import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import os from "os";

export type BashProcessStatus = "running" | "exited" | "error" | "terminated";

const LOG_CAP = 20000; // max characters of combined output kept per process
const MAX_LINE_LOG = 5000; // hard cap on number of log lines retained

/**
 * Tracks one spawned shell process: its live status, combined stdout/stderr
 * log ring buffer, and exit info. Kept in memory for the lifetime of the
 * host process so long-running / endless processes (dev servers, watchers)
 * can be inspected and terminated later instead of blocking a tool call.
 */
class BashProcess {
    id: string;
    command: string;
    cwd: string;
    child: ChildProcessWithoutNullStreams;
    status: BashProcessStatus = "running";
    exitCode: number | null = null;
    signal: string | null = null;
    startedAt: number = Date.now();
    endedAt: number | null = null;
    #lines: string[] = [];
    #waiters: Array<() => void> = [];

    constructor(id: string, command: string, cwd: string, child: ChildProcessWithoutNullStreams) {
        this.id = id;
        this.command = command;
        this.cwd = cwd;
        this.child = child;
    }

    pushChunk(chunk: string) {
        const parts = chunk.split(/\r\n|\r|\n/);
        // merge the first part into the last existing line if the previous
        // chunk didn't end on a newline boundary
        if (this.#lines.length > 0 && !this.#endsWithNewlineFlag) {
            this.#lines[this.#lines.length - 1] += parts.shift();
        }
        this.#lines.push(...parts);
        this.#endsWithNewlineFlag = chunk.endsWith("\n") || chunk.endsWith("\r");
        if (this.#lines.length > MAX_LINE_LOG) {
            this.#lines.splice(0, this.#lines.length - MAX_LINE_LOG);
        }
        this.#capChars();
    }

    #endsWithNewlineFlag = true;

    #capChars() {
        let total = this.#lines.reduce((sum, l) => sum + l.length + 1, 0);
        while (total > LOG_CAP && this.#lines.length > 1) {
            total -= this.#lines[0].length + 1;
            this.#lines.shift();
        }
    }

    getLastLines(count: number): string[] {
        if (count <= 0) return [];
        return this.#lines.slice(Math.max(0, this.#lines.length - count));
    }

    getAllLines(): string[] {
        return this.#lines;
    }

    markFinished(exitCode: number | null, signal: string | null) {
        this.status = signal ? "terminated" : exitCode === 0 ? "exited" : "error";
        this.exitCode = exitCode;
        this.signal = signal;
        this.endedAt = Date.now();
        const waiters = this.#waiters;
        this.#waiters = [];
        waiters.forEach((w) => w());
    }

    /** Resolves when the process exits, or after timeoutMs elapses (whichever first). */
    waitFor(timeoutMs: number): Promise<void> {
        if (this.status !== "running") return Promise.resolve();
        return new Promise((res) => {
            const timer = setTimeout(() => {
                this.#waiters = this.#waiters.filter((w) => w !== onDone);
                res();
            }, timeoutMs);
            const onDone = () => {
                clearTimeout(timer);
                res();
            };
            this.#waiters.push(onDone);
        });
    }
}

const processes: Map<string, BashProcess> = new Map();
let counter = 0;

function nextId(): string {
    counter += 1;
    return `p${counter}`;
}

export function spawnProcess(command: string, cwd?: string): BashProcess {
    const id = nextId();
    const resolvedCwd = cwd || process.cwd();

    const shell = os.platform() === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = os.platform() === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];

    const child = spawn(shell, shellArgs, {
        cwd: resolvedCwd,
        windowsVerbatimArguments: os.platform() === "win32",
    }) as ChildProcessWithoutNullStreams;

    const proc = new BashProcess(id, command, resolvedCwd, child);

    child.stdout.on("data", (data: Buffer) => proc.pushChunk(data.toString("utf-8")));
    child.stderr.on("data", (data: Buffer) => proc.pushChunk(data.toString("utf-8")));

    child.on("error", (err) => {
        proc.pushChunk(`[process error] ${err.message}`);
        proc.markFinished(null, null);
    });

    child.on("close", (code, signal) => {
        proc.markFinished(code, signal);
    });

    processes.set(id, proc);
    return proc;
}

export function getProcess(id: string): BashProcess {
    const proc = processes.get(id);
    if (!proc) throw new Error(`no bash process found with id "${id}"`);
    return proc;
}

export function listProcesses(): BashProcess[] {
    return Array.from(processes.values());
}

export function writeToProcess(id: string, text: string, appendNewline = true): void {
    const proc = getProcess(id);
    if (proc.status !== "running") {
        throw new Error(`process "${id}" is not running (status: ${proc.status})`);
    }
    proc.child.stdin.write(appendNewline ? `${text}\n` : text);
}

export function terminateProcess(id: string, signal: NodeJS.Signals = "SIGTERM"): void {
    const proc = getProcess(id);
    if (proc.status !== "running") return;
    proc.child.kill(signal);
}

export default BashProcess;
export { BashProcess };
