export class MCPTool {
    #options;
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
        execute: (envID: string, inputs: Record<string, any>) => Promise<any>;
    }) {
        this.#options = options;
    }

    getOptions() {
        return this.#options;
    }
}

export default MCPTool;