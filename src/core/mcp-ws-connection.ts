import * as http from "http";
import * as https from "https";
import { WebSocket, WebSocketServer, type ClientOptions } from "ws";
import MCPConnection from "./mcp-connection.js";

export interface MCPWSTLSOptions {
    /** Private key (PEM), e.g. fs.readFileSync("key.pem") or its contents. */
    key: string | Buffer;
    /** Certificate (PEM), e.g. fs.readFileSync("cert.pem") or its contents. */
    cert: string | Buffer;
    /** Optional CA certificate(s), useful for verifying client certs or self-signed chains. */
    ca?: string | Buffer | (string | Buffer)[];
}

export interface MCPWSConnectionOptions {
    /**
     * "server": bind a WebSocketServer and wait for a peer to connect.
     * "client": connect out to `url`.
     */
    mode: "server" | "client";
    /** Required when mode === "client". e.g. "ws://localhost:8080" or "wss://host:port" */
    url?: string;
    /** Required when mode === "server". Port to listen on. */
    port?: number;
    /** Optional host to bind to when mode === "server". */
    host?: string;
    /** Reconnect delay (ms) for client mode after a disconnect. Default 500. */
    reconnectDelay?: number;
    /**
     * Shared token both sides must agree on. The server only accepts
     * connections from clients that present this exact token; the client
     * sends it automatically. If omitted, no auth check is performed.
     */
    token?: string;
    /**
     * Optional TLS key/cert (and CA). When provided:
     *  - server mode binds an HTTPS server and serves WSS.
     *  - client mode is expected to connect via a wss:// url; the ca
     *    (if given) is used to validate the server's certificate.
     * When omitted, server mode uses plain HTTP/WS.
     */
    tls?: MCPWSTLSOptions;
}

const TOKEN_HEADER = "x-mcp-ws-token";

export class MCPWSConnection extends MCPConnection {
    #options: MCPWSConnectionOptions;
    #ws: WebSocket | null = null;
    #wss: WebSocketServer | null = null;
    #httpServer: http.Server | https.Server | null = null;
    #writeBuffer: string[] = [];
    #closed = false;

    constructor(options: MCPWSConnectionOptions) {
        super(true);
        this.#options = options;

        if (options.mode === "client" && !options.url) {
            throw new Error("MCPWSConnection: 'url' is required when mode is 'client'");
        }
        if (options.mode === "server" && !options.port) {
            throw new Error("MCPWSConnection: 'port' is required when mode is 'server'");
        }

        this.on("write_to_server", (data: unknown) => {
            if (this.#options.mode === "client") this.#sendJSON(data);
        });
        this.on("write_to_client", (data: unknown) => {
            if (this.#options.mode === "server") this.#sendJSON(data);
        });

        if (options.mode === "server") {
            this.#startServer();
        } else {
            this.#connectClient();
        }
    }

    override close(): void {
        this.#closed = true;
        this.#ws?.close();
        this.#wss?.close();
        this.#httpServer?.close();
    }

    #startServer(): void {
        this.emit("role", "server");

        const useTLS = !!this.#options.tls;

        const httpServer = useTLS
            ? https.createServer({
                key: this.#options.tls!.key,
                cert: this.#options.tls!.cert,
                ca: this.#options.tls!.ca,
            })
            : http.createServer();

        this.#httpServer = httpServer;

        const wss = new WebSocketServer({ noServer: true });
        this.#wss = wss;

        httpServer.on("upgrade", (request, socket, head) => {
            if (!this.#isTokenValid(request.headers[TOKEN_HEADER])) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request);
            });
        });

        wss.on("connection", (socket) => {
            this.#attachSocket(socket);
        });

        wss.on("error", (err) => this.emit("error", err));
        httpServer.on("error", (err) => this.emit("error", err));

        httpServer.listen(this.#options.port, this.#options.host, () => {
            this.emit("listening", this.#options.port);
        });
    }

    #isTokenValid(headerValue: string | string[] | undefined): boolean {
        const expected = this.#options.token;
        if (!expected) return true; // no token configured => no auth check

        const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        return provided === expected;
    }

    #connectClient(): void {
        this.emit("role", "client");

        const headers: Record<string, string> = {};
        if (this.#options.token) {
            headers[TOKEN_HEADER] = this.#options.token;
        }

        const wsOptions: ClientOptions = { headers };
        if (this.#options.tls?.ca) {
            wsOptions.ca = this.#options.tls.ca;
        }

        const socket = new WebSocket(this.#options.url!, wsOptions);

        socket.once("open", () => {
            this.#attachSocket(socket);
        });

        socket.once("error", (err) => {
            this.emit("error", err);
            this.#maybeReconnect();
        });
    }

    #attachSocket(sock: WebSocket): void {
        this.#ws = sock;

        for (const line of this.#writeBuffer) {
            sock.send(line);
        }
        this.#writeBuffer = [];

        sock.on("message", (data) => {
            this.#handleIncoming(data.toString("utf8"));
        });

        sock.on("close", () => {
            this.emit("disconnected");
            if (this.#ws === sock) this.#ws = null;
            this.#maybeReconnect();
        });

        sock.on("error", (err) => {
            this.emit("error", err);
        });

        this.emit("connected", this.#options.mode);
    }

    #sendJSON(data: unknown): void {
        let line: string;
        try {
            line = JSON.stringify(data);
        } catch (err) {
            this.emit("error", new Error(`MCPWSConnection: cannot serialise data ${err}`));
            return;
        }

        if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
            this.#ws.send(line);
        } else {
            this.#writeBuffer.push(line);
        }
    }

    #handleIncoming(raw: string): void {
        const trimmed = raw.trim();
        if (!trimmed) return;

        try {
            const parsed = JSON.parse(trimmed);
            if (this.#options.mode === "server") {
                this.emit("server_read", parsed);
            } else {
                this.emit("client_read", parsed);
            }
        } catch {
            this.emit("error", new Error(`MCPWSConnection: malformed JSON – ${trimmed}`));
        }
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

export default MCPWSConnection;