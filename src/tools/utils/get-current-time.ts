import MCPTool from "../../core/mcp.js";

export const GetCurrentTimeTool = new MCPTool({
    name: "get-current-time",
    description: "Returns current time (24h) and today's date in Gregorian, Persian, and Islamic calendars.",
    inputs: [],
    execute: async (_: string, __: Record<string, any>): Promise<any> => {
        const now = new Date();
        const time = now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });

        const gregorian = now.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });

        const persian = now.toLocaleDateString("fa-IR-u-ca-persian", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });

        const hijri = now.toLocaleDateString("ar-SA-u-ca-islamic", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });

        return {
            time,
            gregorian,
            persian,
            hijri
        };
    },
});

export default GetCurrentTimeTool;