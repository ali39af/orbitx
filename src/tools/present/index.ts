export { PresentAddTool } from "./add.js";
export { PresentClearTool } from "./clear.js";
export { PresentGetListTool } from "./get-list.js";
export { PresentInteraction } from "./interaction.js";
export type { PresentEvent } from "./interaction.js";
export { getPresentFolder } from "./utils.js";


import { PresentAddTool } from "./add.js";
import { PresentClearTool } from "./clear.js";
import { PresentGetListTool } from "./get-list.js";


export const PresentTools = () => [
    PresentAddTool(),
    PresentClearTool(),
    PresentGetListTool()
];