import EventEmitter from "events";

export class MCPConnection extends EventEmitter {
    constructor(overrided: boolean = false) {
        super();

        if (!overrided)
            this.on("write", (data) => this.emit("read", data))
    }
}

export default MCPConnection;