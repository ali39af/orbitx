export { FsReadFileTool } from "./read-file.js";
export { FsWriteFileTool } from "./write-file.js";
export { FsEditFileTool } from "./edit-file.js";
export { FsListDirTool } from "./list-dir.js";
export { FsCreateDirTool } from "./create-dir.js";
export { FsDeleteTool } from "./delete.js";
export { FsMoveTool } from "./move.js";
export { FsStatTool } from "./stat.js";
export { FsInteraction } from "./interaction.js";
export type { FsEvent } from "./interaction.js";


import { FsReadFileTool } from "./read-file.js";
import { FsWriteFileTool } from "./write-file.js";
import { FsEditFileTool } from "./edit-file.js";
import { FsListDirTool } from "./list-dir.js";
import { FsCreateDirTool } from "./create-dir.js";
import { FsDeleteTool } from "./delete.js";
import { FsMoveTool } from "./move.js";
import { FsStatTool } from "./stat.js";


export const FsTools = () => [
    FsReadFileTool(),
    FsWriteFileTool(),
    FsEditFileTool(),
    FsListDirTool(),
    FsCreateDirTool(),
    FsDeleteTool(),
    FsMoveTool(),
    FsStatTool()
];