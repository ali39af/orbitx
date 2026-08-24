export { GetCurrentTimeTool } from "./get-current-time.js";
export { DelayTool } from "./delay.js";
export { ReadImageTool } from "./read-image.js";


import { GetCurrentTimeTool } from "./get-current-time.js";
import { DelayTool } from "./delay.js";
import { ReadImageTool } from "./read-image.js";


export const UtilTools = () => [
    GetCurrentTimeTool(),
    DelayTool(),
    ReadImageTool()
];