import * as net from "net";
import * as fs from "fs";
import MCPConnection from "./mcp-connection.js";

type Role = "server" | "client" | "pending";

export class MCPIPCConnection extends MCPConnection {
    private readonly socketPath: string;
    private socket: net.Socket | null = null;
    private server: net.Server | null = null;
    private role: Role = "pending";
    private writeBuffer: Buffer[] = [];
    private readBuffer = "";

    constructor(socketPath: string) {
        super(true);
        this.socketPath = socketPath;

        this.on("write", (data: unknown) => {
            this._sendJSON(data);
        });

        setTimeout(() => {
            this._tryConnect();
        }, Math.random() * 200); // Pervent Race Condtion
    }

    close(): void {
        this.socket?.destroy();
        this.server?.close();
        this._cleanSocketFile();
    }

    private _tryConnect(): void {
        const sock = net.createConnection({ path: this.socketPath });

        sock.once("connect", () => {
            this.role = "client";
            this.emit("role", "client");
            this._attachSocket(sock);
        });

        sock.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
                sock.destroy();
                this._becomeServer();
            } else {
                this.emit("error", err);
            }
        });
    }

    private _becomeServer(): void {
        this._cleanSocketFile();

        const srv = net.createServer((peer) => {
            this.role = "server";
            this.emit("role", "server");

            srv.close();

            this._attachSocket(peer);
        });

        srv.on("error", (err) => this.emit("error", err));

        srv.listen({ path: this.socketPath }, () => {
            this.server = srv;
            this.emit("listening", this.socketPath);
        });
    }

    private _attachSocket(sock: net.Socket): void {
        this.socket = sock;

        for (const chunk of this.writeBuffer) {
            sock.write(chunk);
        }
        this.writeBuffer = [];

        sock.setEncoding("utf8");

        sock.on("data", (chunk: string) => {
            this._handleIncoming(chunk);
        });

        sock.on("end", () => {
            this.emit("disconnected");
            this._maybeReconnect();
        });

        sock.on("error", (err: NodeJS.ErrnoException) => {
            this.emit("error", err);
        });

        this.emit("connected", this.role);
    }

    private _sendJSON(data: unknown): void {
        let line: string;
        try {
            line = JSON.stringify(data) + "\n";
        } catch (err) {
            this.emit("error", new Error(`MCPIPCConnection: cannot serialise data – ${err}`));
            return;
        }

        const chunk = Buffer.from(line, "utf8");

        if (this.socket && !this.socket.destroyed) {
            this.socket.write(chunk);
        } else {
            this.writeBuffer.push(chunk);
        }
    }

    private _handleIncoming(chunk: string): void {
        this.readBuffer += chunk;

        const lines = this.readBuffer.split("\n");

        this.readBuffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const parsed = JSON.parse(trimmed);
                this.emit("read", parsed);
            } catch {
                this.emit("error", new Error(`MCPIPCConnection: malformed JSON – ${trimmed}`));
            }
        }
    }

    private _cleanSocketFile(): void {
        try {
            fs.unlinkSync(this.socketPath);
        } catch { }
    }

    private _maybeReconnect(): void {
        if (this.role === "client") {
            setTimeout(() => {
                this.role = "pending";
                this._tryConnect();
            }, 500);
        }
    }
}

export default MCPIPCConnection;