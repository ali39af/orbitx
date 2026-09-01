import type MCPRNG from "./mcp-rng.js";
import type MCPStorage from "./mcp-storage.js";
import type { ProviderType } from "./ai-provider.js";


export interface MCPToolOutput {
    output: Record<string, any>;
}

export function normalizeToolOutput(raw: any): MCPToolOutput {
    return { output: raw ?? {} };
}


export abstract class MCP {
    abstract getStorage(): MCPStorage;
    abstract getRNG(): MCPRNG;
    abstract executeProvider(toolCallId: string, type: ProviderType, input: Record<string, any>): Promise<{ output: Record<string, any> }>;
}

/** Convenience helper: get a fresh, guaranteed-unique hex id from an MCP instance's RNG. */
export async function generateRefId(mcp?: MCP): Promise<string> {
    if (!mcp) return `0x${Math.random().toString(16).slice(2, 10)}`;
    return mcp.getRNG().getRNG();
}

export class MCPTool {
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
        execute: (
            envID: string,
            inputs: Record<string, any>,
            toolCallId?: string,
            mcp?: MCP
        ) => Promise<any>;
    }) {
        this.#options = { stopIterationAfterUsingThisTool: false, ...options };
    }

    setMCP(mcp: MCP) {
        this.#mcp = mcp;
    }

    getMCP() {
        return this.#mcp;
    }

    getOptions() {
        return this.#options;
    }
}

export default MCPTool;