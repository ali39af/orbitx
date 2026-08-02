export { BashRunTool } from "./run.js";
export { BashWaitTool } from "./wait.js";
export { BashLogsTool } from "./logs.js";
export { BashListTool } from "./list.js";
export { BashWriteInputTool } from "./write-input.js";
export { BashTerminateTool } from "./terminate.js";
export { BashInteraction } from "./interaction.js";
export type { BashEvent } from "./interaction.js";


import { BashRunTool } from "./run.js";
import { BashWaitTool } from "./wait.js";
import { BashLogsTool } from "./logs.js";
import { BashListTool } from "./list.js";
import { BashWriteInputTool } from "./write-input.js";
import { BashTerminateTool } from "./terminate.js";


export const BashTools = () => [
    BashRunTool(),
    BashWaitTool(),
    BashLogsTool(),
    BashListTool(),
    BashWriteInputTool(),
    BashTerminateTool()
];
