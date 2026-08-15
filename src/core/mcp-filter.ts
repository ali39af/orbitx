export class MCPFilter {
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

export default MCPFilter;