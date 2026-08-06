import * as net from "net";
import * as fs from "fs";
import MCPConnection from "./mcp-connection.js";

export interface MCPIPCConnectionOptions {
    /** Filesystem path of the IPC socket. */
    socketPath: string;
    /**
     * "server": bind the socket and listen for a peer to connect.
     * "client": connect out to an existing socket.
     */
    mode: "server" | "client";
    /** Reconnect delay (ms) for client mode after a disconnect. Default 500. */
    reconnectDelay?: number;
}

export class MCPIPCConnection extends MCPConnection {
    #options: MCPIPCConnectionOptions;
    #socket: net.Socket | null = null;
    #server: net.Server | null = null;
    #writeBuffer: Buffer[] = [];
    #readBuffer = "";
    #closed = false;

    constructor(options: MCPIPCConnectionOptions) {
        super(true);
        this.#options = options;

        this.on("write_to_server", (data: unknown) => {
            if (this.#options.mode === "client") this.#sendJSON(data);
        });
        this.on("write_to_client", (data: unknown) => {
            if (this.#options.mode === "server") this.#sendJSON(data);
        });

        if (this.#options.mode === "server") {
            this.#startServer();
        } else {
            this.#connectClient();
        }
    }

    override close(): void {
        this.#closed = true;
        this.#socket?.destroy();
        this.#server?.close();
        if (this.#options.mode === "server") {
            this.#cleanSocketFile();
        }
    }

    #startServer(): void {
        this.emit("role", "server");

        this.#cleanSocketFile();

        const srv = net.createServer((peer) => {
            this.#attachSocket(peer);
        });

        srv.on("error", (err) => this.emit("error", err));

        srv.listen({ path: this.#options.socketPath }, () => {
            this.#server = srv;
            this.emit("listening", this.#options.socketPath);
        });
    }

    #connectClient(): void {
        this.emit("role", "client");

        const sock = net.createConnection({ path: this.#options.socketPath });

        sock.once("connect", () => {
            this.#attachSocket(sock);
        });

        sock.once("error", (err: NodeJS.ErrnoException) => {
            this.emit("error", err);
            this.#maybeReconnect();
        });
    }

    #attachSocket(sock: net.Socket): void {
        this.#socket = sock;

        for (const chunk of this.#writeBuffer) {
            sock.write(chunk);
        }
        this.#writeBuffer = [];

        sock.setEncoding("utf8");

        sock.on("data", (chunk: string) => {
            this.#handleIncoming(chunk);
        });

        sock.on("end", () => {
            this.emit("disconnected");
            if (this.#socket === sock) this.#socket = null;
            this.#maybeReconnect();
        });

        sock.on("error", (err: NodeJS.ErrnoException) => {
            this.emit("error", err);
        });

        this.emit("connected", this.#options.mode);
    }

    #sendJSON(data: unknown): void {
        let line: string;
        try {
            line = JSON.stringify(data) + "\n";
        } catch (err) {
            this.emit("error", new Error(`MCPIPCConnection: cannot serialise data – ${err}`));
            return;
        }

        const chunk = Buffer.from(line, "utf8");

        if (this.#socket && !this.#socket.destroyed) {
            this.#socket.write(chunk);
        } else {
            this.#writeBuffer.push(chunk);
        }
    }

    #handleIncoming(chunk: string): void {
        this.#readBuffer += chunk;

        const lines = this.#readBuffer.split("\n");

        this.#readBuffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const parsed = JSON.parse(trimmed);
                if (this.#options.mode === "server") {
                    this.emit("server_read", parsed);
                } else {
                    this.emit("client_read", parsed);
                }
            } catch {
                this.emit("error", new Error(`MCPIPCConnection: malformed JSON – ${trimmed}`));
            }
        }
    }

    #cleanSocketFile(): void {
        try {
            fs.unlinkSync(this.#options.socketPath);
        } catch { }
    }

    #maybeReconnect(): void {
        if (this.#closed) return;
        if (this.#options.mode === "client") {
            setTimeout(() => {
                this.#connectClient();
            }, this.#options.reconnectDelay ?? 500);
        }
    }
}

export default MCPIPCConnection;