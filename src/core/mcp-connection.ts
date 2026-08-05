import EventEmitter from "events";

/**
 * Base class for all MCP connections.
 *
 * Two logical, one-directional channels are defined:
 *  - "write_to_server" -> received by the server side as "server_read"
 *  - "write_to_client" -> received by the client side as "client_read"
 *
 * This keeps client writes from looping back to the client (and vice versa)
 * once a connection is shared/subscribed by both a client and a server on
 * the same object, which was the bug with the old single "write"/"read" pair.
 *
 * Subclasses that talk to a real transport (IPC socket, WebSocket, etc.)
 * should pass `overrided = true` and implement their own wiring: forward
 * "write_to_server"/"write_to_client" over the wire, and emit
 * "server_read"/"client_read" locally depending on which role the transport
 * is currently playing.
 */
export class MCPConnection extends EventEmitter {
    constructor(overrided: boolean = false) {
        super();

        if (!overrided) {
            // Loopback mode (e.g. same-process client+server for testing):
            // whatever is written to the server is what the server reads,
            // whatever is written to the client is what the client reads.
            this.on("write_to_server", (data) => this.emit("server_read", data));
            this.on("write_to_client", (data) => this.emit("client_read", data));
        }
    }
}

export default MCPConnection;