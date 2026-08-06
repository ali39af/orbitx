import os from "os";
import { randomUUID } from "crypto";
import { spawn, execFileSync, ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import type MCPConnection from "./mcp-connection.js";
import MCPIPCConnection from "./mcp-ipc-connection.js";
import MCPWSConnection from "./mcp-ws-connection.js";

type ConnectionMode = "ipc" | "ws";

export class MCPComputer {
    #mountPath: string;
    #ports: number[] | "*";
    #hostNetwork: boolean;
    #image: string;
    #containerName: string;
    #child: ReturnType<typeof spawn> | null = null;
    #exitHandler: (() => void) | null = null;

    #connectionMode: ConnectionMode;
    #ipcPath: string;
    #wsPort: number;
    #wsToken: string;

    #connection: MCPConnection | undefined;

    constructor(mountPath: string, ports: number[] | "*", image: string = "orbitx-sandbox:0.1") {
        this.#connectionMode = os.platform() === "win32" ? "ws" : "ipc";

        this.#hostNetwork = ports === "*";

        this.#mountPath = path.resolve(mountPath);
        this.#ports = ports;
        this.#image = image;
        this.#containerName = `mcp-sandbox-${randomUUID()}`;

        this.#ipcPath = `/tmp/mcp-server-${randomUUID()}`;
        this.#wsPort = 0;
        this.#wsToken = randomUUID();
    }

    getConnection(wsHost: string = "localhost"): MCPConnection {
        if (this.#connectionMode === "ipc") {
            this.#connection = new MCPIPCConnection({
                socketPath: `${this.#ipcPath}/socket.sock`,
                mode: "client",
            });
            return this.#connection;
        }

        if (!this.#wsPort) {
            throw new Error("getConnection() is only available in 'ws' mode after start() has resolved a port.");
        }

        this.#connection = new MCPWSConnection({
            mode: "client",
            url: `ws://${wsHost}:${this.#wsPort}`,
            token: this.#wsToken,
        });
        return this.#connection;
    }

    getPresentsHostPath(): string {
        return path.join(this.#mountPath, "presents");
    }


    #prepareHostPaths(containerUid = 1000, containerGid = 1000) {
        const workspaceHost = path.join(this.#mountPath, "workspace");
        const storageHost = path.join(this.#mountPath, "mcp-server-storage");
        const presentsHost = path.join(this.#mountPath, "presents");
        const userInputsHost = path.join(this.#mountPath, "user-inputs");
        const dirs = [workspaceHost, storageHost, presentsHost, userInputsHost];

        if (this.#connectionMode === "ipc") {
            dirs.push(this.#ipcPath);
        }

        for (const dir of dirs) {
            fs.mkdirSync(dir, { recursive: true });
        }
        for (const dir of dirs) {
            try {
                fs.chownSync(dir, containerUid, containerGid);
            } catch (err: any) {
                if (err.code === "EPERM") {
                    try {
                        execFileSync("sudo", ["chown", "-R", `${containerUid}:${containerGid}`, dir]);
                    } catch {
                        throw new Error(`Could not chown ${dir} to ${containerUid}:${containerGid}.`);
                    }
                } else {
                    throw err;
                }
            }
        }
    }

    /** Finds a free TCP port on the host by briefly binding to port 0. */
    #pickFreePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const srv = net.createServer();
            srv.unref();
            srv.on("error", reject);
            srv.listen(0, () => {
                const address = srv.address();
                if (address && typeof address === "object") {
                    const port = address.port;
                    srv.close(() => resolve(port));
                } else {
                    srv.close(() => reject(new Error("Could not determine a free port.")));
                }
            });
        });
    }

    #buildDockerArgs(): string[] {
        const workspaceHost = path.join(this.#mountPath, "workspace");
        const storageHost = path.join(this.#mountPath, "mcp-server-storage");
        const presentsHost = path.join(this.#mountPath, "presents");
        const userInputsHost = path.join(this.#mountPath, "user-inputs");

        const args = [
            "run", "--rm",
            "--name", this.#containerName,
            "-v", `${workspaceHost}:/home/ubuntu/workspace`,
            "-v", `${storageHost}:/home/ubuntu/mcp-data`,
            "-v", `${presentsHost}:/home/ubuntu/presents`,
            "-v", `${userInputsHost}:/home/ubuntu/user-inputs`,
            "-e", "PRESENT_PATH=/home/ubuntu/presents",
        ];

        if (this.#connectionMode === "ipc") {
            args.push("-v", `${this.#ipcPath}:/tmp/mcp-server`);
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
                args.push("-p", `${this.#wsPort}:${this.#wsPort}`);
            }
        }

        args.push(this.#image);
        return args;
    }

    async start(): Promise<void> {
        if (this.#connectionMode === "ws") {
            this.#wsPort = await this.#pickFreePort();
        }

        this.#prepareHostPaths();

        const args = this.#buildDockerArgs();
        const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
        this.#child = child;

        this.#exitHandler = () => {
            try {
                execFileSync("docker", ["kill", this.#containerName], { stdio: "ignore" });
            } catch {
                // already stopped, fine
            }
        };
        process.on("exit", this.#exitHandler);

        await this.#waitForReadyLog(child);
    }

    #waitForReadyLog(child: ChildProcess, timeoutMs = 30_000): Promise<void> {
        const READY_RE = /MCP Server Stared/;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                child.stdout?.off("data", onData);
                reject(new Error(`timed out waiting for container ready log after ${timeoutMs}ms`));
            }, timeoutMs);

            const onData = (chunk: Buffer) => {
                if (READY_RE.test(chunk.toString())) {
                    clearTimeout(timer);
                    child.stdout?.off("data", onData);
                    resolve();
                }
            };

            child.stdout?.on("data", onData);
        });
    }

    async stop(): Promise<void> {
        if (this.#exitHandler) {
            process.off("exit", this.#exitHandler);
            this.#exitHandler = null;
        }

        const child = this.#child;
        this.#child = null;

        if (!child) {
            return;
        }

        const exited = new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.once("error", () => resolve());
        });

        try {
            execFileSync("docker", ["kill", this.#containerName], { stdio: "ignore" });
        } catch {
            // already stopped, fine
        }

        this.#connection?.close();

        await exited;
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
            `End of sandbox info`
        ].join("\n");
    }
}

export default MCPComputer;