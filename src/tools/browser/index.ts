export { BrowserCreateSessionTool } from "./create-session.js";
export { BrowserRemoveSessionTool } from "./remove-session.js";
export { BrowserGetSessionsTool } from "./get-sessions.js";
export { BrowserNavigateTool } from "./navigate.js";
export { BrowserConsoleTool } from "./console.js";
export { BrowserInjectTool } from "./inject.js";
export { BrowserReadTool } from "./read.js";
export { BrowserClickTool } from "./click.js";
export { BrowserFillTool } from "./fill.js";
export { BrowserSubmitFormTool } from "./submit-form.js";
export { BrowserScrollInfoTool } from "./scroll-info.js";
export { BrowserScrollTool } from "./scroll.js";
export { BrowserNetworkStatusTool } from "./network-status.js";
export { BrowserNetworkTool } from "./network.js";
export { BrowserScreenshotTool } from "./screenshot.js";
export { BrowserInteraction } from "./interaction.js";
export type { BrowserEvent } from "./interaction.js";

import { BrowserCreateSessionTool } from "./create-session.js";
import { BrowserRemoveSessionTool } from "./remove-session.js";
import { BrowserGetSessionsTool } from "./get-sessions.js";
import { BrowserNavigateTool } from "./navigate.js";
import { BrowserConsoleTool } from "./console.js";
import { BrowserInjectTool } from "./inject.js";
import { BrowserReadTool } from "./read.js";
import { BrowserClickTool } from "./click.js";
import { BrowserFillTool } from "./fill.js";
import { BrowserSubmitFormTool } from "./submit-form.js";
import { BrowserScrollInfoTool } from "./scroll-info.js";
import { BrowserScrollTool } from "./scroll.js";
import { BrowserNetworkStatusTool } from "./network-status.js";
import { BrowserNetworkTool } from "./network.js";
import { BrowserScreenshotTool } from "./screenshot.js";

export const BrowserTools = () => [
    BrowserCreateSessionTool(),
    BrowserRemoveSessionTool(),
    BrowserGetSessionsTool(),
    BrowserNavigateTool(),
    BrowserConsoleTool(),
    BrowserInjectTool(),
    BrowserReadTool(),
    BrowserClickTool(),
    BrowserFillTool(),
    BrowserSubmitFormTool(),
    BrowserScrollInfoTool(),
    BrowserScrollTool(),
    BrowserNetworkStatusTool(),
    BrowserNetworkTool(),
    BrowserScreenshotTool(),
];