import type MCPStorage from "./mcp-storage.js";


/* MCP RNG Generate unique cross reference hex numbers shared with tools and guaranty tools never use duplicate id */
export class MCPRNG {
    #storage: MCPStorage;

    constructor(storage: MCPStorage) {
        this.#storage = storage;
    }

    async getRNG(): Promise<string> {
        const current = await this.#storage.get("__RNG__");
        const rng = current ? Number(current) : 0;
        await this.#storage.set("__RNG__", (rng + 1).toString());
        return `0x${rng.toString(16)}`;
    }
}

export default MCPRNG;