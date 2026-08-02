export { GetCurrentTimeTool } from "./get-current-time.js";
export { DelayTool } from "./delay.js";


import { GetCurrentTimeTool } from "./get-current-time.js";
import { DelayTool } from "./delay.js";


export const UtilTools = () => [
    GetCurrentTimeTool(),
    DelayTool()
];