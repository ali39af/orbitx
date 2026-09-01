export class MCPOutputFilter {
    #values: (string | RegExp)[];

    constructor(values: (string | RegExp)[]) {
        this.#values = values;
    }

    filter(input: any) {
        try {
            const isString = typeof input === "string";
            let output = isString ? input : JSON.stringify(input);

            for (const value of this.#values) {
                if (value instanceof RegExp) {
                    const flags = value.flags.includes("g") ? value.flags : value.flags + "g";
                    output = output.replace(new RegExp(value.source, flags), "FILTERED_OUTPUT");
                } else {
                    output = output.replaceAll(value, "FILTERED_OUTPUT");
                }
            }

            return isString ? output : JSON.parse(output);
        } catch (error) {
            console.error(error);
            return { message: "FILTERED_OUTPUT" };
        }
    }
}

/** @deprecated Renamed to `MCPOutputFilter` — this alias will be removed in 1.0.0. */
export const MCPFilter = MCPOutputFilter;
/** @deprecated Renamed to `MCPOutputFilter` — this alias will be removed in 1.0.0. */
export type MCPFilter = MCPOutputFilter;

export default MCPOutputFilter;
