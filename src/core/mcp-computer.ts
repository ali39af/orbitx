import os from "os";
import { randomUUID } from "crypto";
import { spawn, execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import type MCPConnection from "./mcp-connection.js";
import MCPIPCConnection from "./mcp-ipc-connection.js";
import MCPWSConnection from "./mcp-ws-connection.js";

type ConnectionMode = "ipc" | "ws";

export interface MCPComputerOptions {
    connectionMode?: ConnectionMode;
    readyTimeoutMs?: number;
    pullTimeoutMs?: number;
    handshakeTimeoutMs?: number;
    onLog?: (line: string, stream: "stdout" | "stderr") => void;
    dockerBin?: string;
}

const PULL_ACTIVITY_RE = /Unable to find image|Pulling from|Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Digest:|Status: Downloaded/;
const READY_RE = /MCP Server Star(?:t)?ed/;
const BOOTING_RE = /Starting Sandbox MCP Server/;
const PORT_CONFLICT_RE = /port is already allocated|address already in use|bind: An attempt was made to access a socket/i;

export class MCPComputer {
    #mountPath: string;
    #ports: number[] | "*";
    #hostNetwork: boolean;
    #image: string;
    #containerName: string;
    #child: ChildProcess | null = null;
    #exitHandler: (() => void) | null = null;

    #connectionMode: ConnectionMode;
    #ipcPath: string;
    #wsPort: number;
    #wsToken: string;

    #connection: MCPConnection | undefined;

    #dockerBin: string;
    #readyTimeoutMs: number;
    #pullTimeoutMs: number;
    #handshakeTimeoutMs: number;
    #onLog: ((line: string, stream: "stdout" | "stderr") => void) | undefined;

    #started = false;
    #stopped = false;
    #log: string[] = [];

    constructor(
        mountPath: string,
        ports: number[] | "*",
        image: string = "aliafsordeh/orbitx-sandbox:0.2",
        options: MCPComputerOptions = {},
    ) {
        this.#connectionMode = options.connectionMode ?? (os.platform() === "linux" ? "ipc" : "ws");

        this.#hostNetwork = ports === "*";

        this.#mountPath = path.resolve(mountPath);
        this.#ports = ports;
        this.#image = image;
        this.#containerName = `mcp-sandbox-${randomUUID()}`;

        this.#ipcPath = path.join(os.tmpdir(), `mcp-server-${randomUUID()}`);
        this.#wsPort = 0;
        this.#wsToken = randomUUID();

        this.#dockerBin = options.dockerBin ?? "docker";
        this.#readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
        this.#pullTimeoutMs = options.pullTimeoutMs ?? 300_000;
        this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 20_000;
        this.#onLog = options.onLog;

        if (this.#hostNetwork && this.#connectionMode === "ws" && os.platform() !== "linux") {
            throw new Error(
                "MCPComputer: ports \"*\" (--network host) does not work on Windows or macOS — Docker Desktop puts the "
                + "container in a VM's network namespace, so nothing it binds is reachable from this machine and "
                + "published ports are ignored. Pass an explicit port list instead, e.g. new MCPComputer(path, [3000, 5173]).",
            );
        }
    }

    getConnection(wsHost: string = "127.0.0.1"): MCPConnection {
        if (this.#connection) return this.#connection;

        if (this.#connectionMode === "ipc") {
            this.#connection = this.#guard(new MCPIPCConnection({
                socketPath: path.join(this.#ipcPath, "socket.sock"),
                mode: "client",
            }));
            return this.#connection;
        }

        if (!this.#wsPort) {
            throw new Error("MCPComputer: getConnection() is only available in 'ws' mode after start() has resolved a port.");
        }

        this.#connection = this.#guard(new MCPWSConnection({
            mode: "client",
            url: `ws://${wsHost}:${this.#wsPort}`,
            token: this.#wsToken,
        }));
        return this.#connection;
    }

    #guard<T extends MCPConnection>(connection: T): T {
        connection.on("error", (err: unknown) => {
            this.#record(`[mcp-computer] connection error: ${err instanceof Error ? err.message : String(err)}\n`, "stderr");
        });
        return connection;
    }

    async waitUntilConnected(timeoutMs = this.#handshakeTimeoutMs): Promise<MCPConnection> {
        const connection = this.getConnection();

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const onConnected = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                connection.off("connected", onConnected);
                reject(new Error(`MCPComputer: connection did not come up within ${timeoutMs}ms.`));
            }, timeoutMs);
            timer.unref?.();
            connection.once("connected", onConnected);
        });

        return connection;
    }

    getPresentsHostPath(): string {
        return path.join(this.#mountPath, "presents");
    }

    getConnectionPort(): number {
        return this.#wsPort;
    }

    getContainerName(): string {
        return this.#containerName;
    }

    #prepareHostPaths(containerUid = 1000, containerGid = 1000) {
        const dirs = [
            path.join(this.#mountPath, "workspace"),
            path.join(this.#mountPath, "mcp-server-storage"),
            path.join(this.#mountPath, "presents"),
            path.join(this.#mountPath, "user-inputs"),
        ];

        if (this.#connectionMode === "ipc") {
            dirs.push(this.#ipcPath);
        }

        for (const dir of dirs) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (os.platform() !== "linux") return;

        for (const dir of dirs) {
            let stat: fs.Stats;
            try {
                stat = fs.statSync(dir);
            } catch {
                continue;
            }
            if (stat.uid === containerUid && stat.gid === containerGid) continue;

            try {
                fs.chownSync(dir, containerUid, containerGid);
                continue;
            } catch (err: any) {
                if (err?.code !== "EPERM") throw err;
            }

            try {
                execFileSync("sudo", ["-n", "chown", "-R", `${containerUid}:${containerGid}`, dir], { stdio: "ignore" });
            } catch {
                throw new Error(
                    `MCPComputer: could not chown ${dir} to ${containerUid}:${containerGid}, and the sandbox runs as `
                    + `uid ${containerUid} so it would not be able to write there. Run this once by hand:\n`
                    + `  sudo chown -R ${containerUid}:${containerGid} ${dir}`,
                );
            }
        }
    }

    #pickFreePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const srv = net.createServer();
            srv.unref();
            srv.on("error", reject);
            srv.listen({ port: 0, host: "127.0.0.1" }, () => {
                const address = srv.address();
                if (address && typeof address === "object") {
                    const port = address.port;
                    srv.close(() => resolve(port));
                } else {
                    srv.close(() => reject(new Error("MCPComputer: could not determine a free port.")));
                }
            });
        });
    }

    #bindPath(target: string): string {
        const resolved = path.resolve(target);
        return os.platform() === "win32" ? resolved.replace(/\\/g, "/") : resolved;
    }

    #buildDockerArgs(): string[] {
        const args = [
            "run", "--rm", "--init",
            "--name", this.#containerName,
            "-v", `${this.#bindPath(path.join(this.#mountPath, "workspace"))}:/home/ubuntu/workspace`,
            "-v", `${this.#bindPath(path.join(this.#mountPath, "mcp-server-storage"))}:/home/ubuntu/mcp-data`,
            "-v", `${this.#bindPath(path.join(this.#mountPath, "presents"))}:/home/ubuntu/presents`,
            "-v", `${this.#bindPath(path.join(this.#mountPath, "user-inputs"))}:/home/ubuntu/user-inputs`,
            "-e", "PRESENT_PATH=/home/ubuntu/presents",
        ];

        if (this.#connectionMode === "ipc") {
            args.push("-v", `${this.#bindPath(this.#ipcPath)}:/tmp/mcp-server`);
            args.push("-e", "CONNECTION_MODE=IPC");
            args.push("-e", "CONNECTION_PATH=/tmp/mcp-server/socket.sock");
        } else {
            args.push("-e", "CONNECTION_MODE=WS");
            args.push("-e", "CONNECTION_HOST=0.0.0.0");
            args.push("-e", `CONNECTION_PORT=${this.#wsPort}`);
            args.push("-e", `CONNECTION_TOKEN=${this.#wsToken}`);
        }

        if (this.#hostNetwork) {
            args.push("--network", "host");
        } else {
            for (const port of this.#ports as number[]) {
                args.push("-p", `${port}:${port}`);
            }
            if (this.#connectionMode === "ws") {
                args.push("-p", `127.0.0.1:${this.#wsPort}:${this.#wsPort}`);
            }
        }

        args.push(this.#image);
        return args;
    }

    async start(): Promise<void> {
        if (this.#started) {
            throw new Error("MCPComputer: start() has already been called on this instance.");
        }
        this.#started = true;
        this.#stopped = false;

        await this.#assertDockerAvailable();
        this.#prepareHostPaths();

        const attempts = this.#connectionMode === "ws" && !this.#hostNetwork ? 3 : 1;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            if (this.#connectionMode === "ws") {
                this.#wsPort = await this.#pickFreePort();
            }

            try {
                await this.#launch();
                return;
            } catch (err) {
                await this.#teardownChild();
                const retryable = attempt < attempts && PORT_CONFLICT_RE.test(String((err as Error)?.message ?? err));
                if (!retryable) {
                    this.#started = false;
                    throw err;
                }
            }
        }
    }

    async #launch(): Promise<void> {
        this.#log = [];

        const child = spawn(this.#dockerBin, this.#buildDockerArgs(), {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        this.#child = child;

        this.#exitHandler = () => {
            try {
                execFileSync(this.#dockerBin, ["rm", "-f", this.#containerName], { stdio: "ignore", timeout: 10_000 });
            } catch {
                // already gone, fine
            }
        };
        process.on("exit", this.#exitHandler);

        child.on("exit", (code, signal) => {
            this.#record(
                `[mcp-computer] container exited (${signal ? `signal ${signal}` : `exit code ${code}`})\n`,
                "stderr",
            );
        });

        await this.#waitForReady(child);
        await this.#waitForEndpoint();
    }

    isRunning(): boolean {
        const child = this.#child;
        return !!child && child.exitCode === null && child.signalCode === null;
    }

    #waitForReady(child: ChildProcess): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            let pending = "";
            let timer: NodeJS.Timeout;

            const arm = (ms: number) => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    fail(new Error(
                        `MCPComputer: timed out after ${ms}ms waiting for the sandbox to report ready.`
                        + this.#logTail(),
                    ));
                }, ms);
                timer.unref?.();
            };

            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                child.off("error", onError);
                child.off("exit", onExit);
                fn();
            };
            const done = () => settle(resolve);
            const fail = (err: Error) => settle(() => reject(err));

            const consume = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
                const text = chunk.toString("utf8");
                this.#record(text, stream);

                if (settled) return;

                pending = (pending + text).slice(-4096);

                if (PULL_ACTIVITY_RE.test(text)) {
                    arm(this.#pullTimeoutMs);
                } else if (BOOTING_RE.test(pending)) {
                    arm(this.#readyTimeoutMs);
                }

                if (READY_RE.test(pending)) done();
            };

            const onError = (err: NodeJS.ErrnoException) => {
                if (err?.code === "ENOENT") {
                    fail(new Error(
                        `MCPComputer: '${this.#dockerBin}' was not found on PATH. Install Docker (or pass `
                        + `{ dockerBin } to the constructor) and make sure it is on this process's PATH.`,
                    ));
                    return;
                }
                fail(new Error(`MCPComputer: failed to launch '${this.#dockerBin}' — ${err?.message ?? err}`));
            };

            const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
                fail(new Error(
                    `MCPComputer: the container exited before reporting ready `
                    + `(${signal ? `signal ${signal}` : `exit code ${code}`}).`
                    + this.#logTail(),
                ));
            };

            child.stdout?.on("data", consume("stdout"));
            child.stderr?.on("data", consume("stderr"));
            child.stdout?.on("error", () => { });
            child.stderr?.on("error", () => { });
            child.on("error", onError);
            child.on("exit", onExit);

            arm(this.#readyTimeoutMs);
        });
    }

    async #waitForEndpoint(): Promise<void> {
        const deadline = Date.now() + this.#handshakeTimeoutMs;

        const attempt: () => Promise<boolean> = this.#connectionMode === "ipc"
            ? async () => fs.existsSync(path.join(this.#ipcPath, "socket.sock"))
            : () => this.#probeTcp(this.#wsPort);

        let lastError: unknown;
        while (Date.now() < deadline) {
            if (this.#child?.exitCode !== null && this.#child?.exitCode !== undefined) {
                throw new Error(`MCPComputer: the container exited while waiting for its endpoint.${this.#logTail()}`);
            }
            try {
                if (await attempt()) return;
            } catch (err) {
                lastError = err;
            }
            await new Promise((r) => setTimeout(r, 150));
        }

        const where = this.#connectionMode === "ipc"
            ? path.join(this.#ipcPath, "socket.sock")
            : `127.0.0.1:${this.#wsPort}`;
        throw new Error(
            `MCPComputer: the sandbox reported ready but ${where} never accepted a connection within `
            + `${this.#handshakeTimeoutMs}ms${lastError ? ` (${(lastError as Error).message})` : ""}.${this.#logTail()}`,
        );
    }

    #probeTcp(port: number, timeoutMs = 1_000): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = net.connect({ port, host: "127.0.0.1" });
            let settled = false;

            const finish = (ok: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                resolve(ok);
            };

            const timer = setTimeout(() => finish(false), timeoutMs);
            timer.unref?.();

            socket.once("connect", () => finish(true));
            socket.once("error", () => finish(false));
        });
    }

    async #assertDockerAvailable(): Promise<void> {
        const result = await this.#exec(["info", "--format", "{{.ServerVersion}}"], 30_000);
        if (result.code === 0) return;

        const detail = (result.stderr || result.stdout).trim().split("\n").slice(0, 4).join("\n");
        throw new Error(
            `MCPComputer: cannot reach the Docker daemon via '${this.#dockerBin}'. Start Docker Desktop `
            + `(or dockerd) and try again.${detail ? `\n  ${detail}` : ""}`,
        );
    }

    #exec(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            let child: ChildProcess;
            try {
                child = spawn(this.#dockerBin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            } catch (err: any) {
                resolve({ code: null, stdout: "", stderr: String(err?.message ?? err) });
                return;
            }

            let stdout = "";
            let stderr = "";
            let settled = false;

            const finish = (code: number | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ code, stdout, stderr });
            };

            const timer = setTimeout(() => {
                try { child.kill("SIGKILL"); } catch { }
                stderr += `\n(timed out after ${timeoutMs}ms)`;
                finish(null);
            }, timeoutMs);
            timer.unref?.();

            child.stdout?.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
            child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
            child.once("error", (err: Error) => { stderr += err?.message ?? String(err); finish(null); });
            child.once("close", (code) => finish(code));
        });
    }

    #record(text: string, stream: "stdout" | "stderr"): void {
        this.#log.push(text);
        // Bounded so a long-lived sandbox cannot grow this without limit.
        if (this.#log.length > 400) this.#log.splice(0, this.#log.length - 400);

        if (!this.#onLog) return;
        for (const line of text.split("\n")) {
            if (line.trim()) this.#onLog(line, stream);
        }
    }

    #logTail(maxLines = 20): string {
        const lines = this.#log.join("").split("\n").map((l) => l.trimEnd()).filter(Boolean);
        if (!lines.length) return "\n  (the container produced no output)";
        return `\n  container output:\n${lines.slice(-maxLines).map((l) => `    ${l}`).join("\n")}`;
    }

    async #teardownChild(): Promise<void> {
        if (this.#exitHandler) {
            process.off("exit", this.#exitHandler);
            this.#exitHandler = null;
        }

        const child = this.#child;
        this.#child = null;
        if (!child) return;

        const alreadyExited = child.exitCode !== null || child.signalCode !== null;
        const exited = alreadyExited
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                child.once("exit", () => resolve());
                child.once("error", () => resolve());
            });

        await this.#exec(["rm", "-f", this.#containerName], 20_000);

        await Promise.race([
            exited,
            new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    try { child.kill(); } catch { }
                    resolve();
                }, 10_000);
                timer.unref?.();
            }),
        ]);
    }

    async stop(): Promise<void> {
        if (this.#stopped) return;
        this.#stopped = true;

        this.#connection?.close();
        this.#connection = undefined;

        try {
            await this.#teardownChild();
        } finally {
            if (this.#connectionMode === "ipc") {
                try {
                    fs.rmSync(this.#ipcPath, { recursive: true, force: true });
                } catch {
                    // the socket dir is disposable; a leftover in tmpdir is not worth failing stop() over
                }
            }
        }
    }

    getInstructions(): string {
        const workspacePath = "/home/ubuntu/workspace";
        const presentsPath = "/home/ubuntu/presents";
        const userInputsPath = "/home/ubuntu/user-inputs";
        const portsList = this.#hostNetwork
            ? "any (host network mode — all ports are shared with the host)"
            : (this.#ports as number[]).length > 0
                ? (this.#ports as number[]).join(", ")
                : "none";

        return [
            `SandBox info`,
            `Workspace path: ${workspacePath}`,
            `User input files path: ${userInputsPath}`,
            `Presents path: ${presentsPath} (files passed to the present-add tool are copied here and surfaced to the user by the host application)`,
            `Open ports: ${portsList}`,
            `Servers you start must bind 0.0.0.0 (not localhost) or the host will not be able to reach them.`,
            `End of sandbox info`
        ].join("\n");
    }
}

export default MCPComputer;
