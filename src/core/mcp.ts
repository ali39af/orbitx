import EventEmitter from "events";
import type MCPRNG from "./mcp-rng.js";
import type MCPStorage from "./mcp-storage.js";


export type MCPToolOutput =
    | { type: "text"; output: Record<string, any> }
    | { type: "image"; output: { image: string; mimeType?: string;[key: string]: any } };

export function normalizeToolOutput(raw: any): MCPToolOutput {
    if (
        raw &&
        typeof raw === "object" &&
        (raw.type === "text" || raw.type === "image") &&
        raw.output &&
        typeof raw.output === "object"
    ) {
        return raw as MCPToolOutput;
    }
    return { type: "text", output: raw ?? {} };
}


export abstract class MCPCustomClass {
    #mcp: MCP | undefined;
    #events: EventEmitter = new EventEmitter();

    setMCP(mcp: MCP) {
        this.#mcp = mcp;
    }

    getMCP() {
        return this.#mcp;
    }

    /** Subscribe to / emit interaction events from this tool (e.g. "status", "progress"). */
    getEvents(): EventEmitter {
        return this.#events;
    }
}

export abstract class MCP {
    abstract getStorage(): MCPStorage;
    abstract getRNG(): MCPRNG;
}

/** Convenience helper: get a fresh, guaranteed-unique hex id from an MCP instance's RNG. */
export async function generateRefId(mcp?: MCP): Promise<string> {
    if (!mcp) return `0x${Math.random().toString(16).slice(2, 10)}`;
    return mcp.getRNG().getRNG();
}

export class MCPTool<T extends MCPCustomClass | undefined = undefined> {
    #options;
    #mcp: MCP | undefined;

    constructor(options: {
        name: string;
        description: string;
        inputs: {
            name: string;
            type: "number" | "string" | "boolean" | "object" | "array";
            description: string;
            required?: boolean;
            default?: any;
        }[];
        stopIterationAfterUsingThisTool?: boolean
        customClass?: T;
        execute: (
            envID: string,
            inputs: Record<string, any>,
            mcp?: MCP,
            customClass?: T
        ) => Promise<any>;
    }) {
        this.#options = { stopIterationAfterUsingThisTool: false, ...options };
    }

    setMCP(mcp: MCP) {
        this.#mcp = mcp;
        this.#options.customClass?.setMCP(mcp);
    }

    getMCP() {
        return this.#mcp;
    }

    getOptions() {
        return this.#options;
    }
}

export default MCPTool;