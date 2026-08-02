// TODO Add Host ability to docker to open any ports
import os from "os";
import { randomUUID } from "crypto";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export class MCPComputer {
    #mountPath: string;
    #ports: number[];
    #image: string;
    #ipcPath: string;
    #containerName: string;

    constructor(mountPath: string, ports: number[], image: string = "orbitx-sandbox:0.1") {
        if (os.platform() === "win32") {
            throw new Error(
                "This feature is not currently supported natively on Windows. " +
                "Please run via WSL, or use a Unix-like filesystem (this feature needs one)."
            );
        }

        this.#mountPath = path.resolve(mountPath);
        this.#ports = ports;
        this.#image = image;
        this.#ipcPath = `/tmp/mcp-server-${randomUUID()}`;
        this.#containerName = `mcp-sandbox-${randomUUID()}`;
    }

    getIPCSocketPath(): string {
        return `${this.#ipcPath}/socket.sock`;
    }

    /** Host-side path where presented files land (mounted into the container at /home/ubuntu/presents). */
    getPresentsHostPath(): string {
        return path.join(this.#mountPath, "presents");
    }

    #prepareHostPaths(containerUid = 1000, containerGid = 1000) {
        const workspaceHost = path.join(this.#mountPath, "workspace");
        const storageHost = path.join(this.#mountPath, "mcp-server-storage");
        const presentsHost = path.join(this.#mountPath, "presents");
        const dirs = [workspaceHost, storageHost, presentsHost, this.#ipcPath];

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

    buildDockerArgs(): string[] {
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
            "-v", `${this.#ipcPath}:/tmp/mcp-server`,
            "-e", "PRESENT_PATH=/home/ubuntu/presents",
        ];

        for (const port of this.#ports) {
            args.push("-p", `${port}:${port}`);
        }

        args.push(this.#image);
        return args;
    }

    start() {
        this.#prepareHostPaths();

        const args = this.buildDockerArgs();
        const child = spawn("docker", args, { stdio: "inherit" });

        process.on("exit", () => {
            try {
                execFileSync("docker", ["kill", this.#containerName], { stdio: "ignore" });
            } catch {
                // already stopped, fine
            }
        });

        return child;
    }

    getInstructions(): string {
        const workspacePath = "/home/ubuntu/workspace";
        const presentsPath = "/home/ubuntu/presents";
        const userInputsPath = "/home/ubuntu/user-inputs";
        const portsList = this.#ports.length > 0
            ? this.#ports.join(", ")
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