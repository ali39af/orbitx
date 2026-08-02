import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import MCPStorage from "./mcp-storage.js";

export class MCPFSStorage extends MCPStorage {

    #fsStoragePath: string;
    constructor(fsStoragePath = `./data/mcp-storage-${Math.round(Math.random() * 100000)}`) {
        super();
        this.#fsStoragePath = fsStoragePath;
        if (!existsSync(fsStoragePath))
            mkdirSync(fsStoragePath, { recursive: true });
    }

    async get(
        key: string,
    ): Promise<string> {
        try {
            return readFileSync(join(this.#fsStoragePath, createHash("sha256").update(key).digest("hex")), { encoding: "utf-8" });
        } catch (err: any) {
            if (err.code === "ENOENT") return "";
            throw err;
        }
    }

    async set(key: string, value: string): Promise<void> {
        writeFileSync(join(this.#fsStoragePath, createHash("sha256").update(key).digest("hex")), value, { encoding: "utf-8" });
    }
}

export default MCPFSStorage