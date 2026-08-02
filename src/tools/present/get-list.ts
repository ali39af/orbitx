import { basename } from "path";
import { MCPTool, type MCP } from "../../core/mcp.js";
import { PresentInteraction } from "./interaction.js";
import { listPresentFiles, fileSize } from "./utils.js";

export const PresentGetListTool = () => new MCPTool<PresentInteraction>({
    name: "present-get-list",
    description: "get the list of files currently presented to the user (their paths inside the present folder)",
    inputs: [],
    customClass: new PresentInteraction(),
    execute: async (): Promise<any> => {
        const paths = await listPresentFiles();

        const files = await Promise.all(
            paths.map(async (path) => ({
                name: basename(path),
                path,
                size: await fileSize(path),
            }))
        );

        return {
            files,
            total: files.length,
        };
    },
});

export default PresentGetListTool;
