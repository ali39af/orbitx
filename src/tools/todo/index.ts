export { TodoCreateListTool } from "./create-list.js";
export { TodoRemoveListTool } from "./remove-list.js";
export { TodoGetListsTool } from "./get-lists.js";
export { TodoGetListTool } from "./get-list.js";
export { TodoCreateTaskTool } from "./create-task.js";
export { TodoRemoveTaskTool } from "./remove-task.js";
export { TodoCheckTaskTool } from "./check-task.js";
export { TodoInteraction } from "./interaction.js";
export type { TodoTask, TodoList } from "./storage.js";
export type { TodoEvent } from "./interaction.js";


import { TodoCreateListTool } from "./create-list.js";
import { TodoRemoveListTool } from "./remove-list.js";
import { TodoGetListsTool } from "./get-lists.js";
import { TodoGetListTool } from "./get-list.js";
import { TodoCreateTaskTool } from "./create-task.js";
import { TodoRemoveTaskTool } from "./remove-task.js";
import { TodoCheckTaskTool } from "./check-task.js";


export const TodoTools = () => [
    TodoCreateListTool(),
    TodoRemoveListTool(),
    TodoGetListsTool(),
    TodoGetListTool(),
    TodoCreateTaskTool(),
    TodoRemoveTaskTool(),
    TodoCheckTaskTool()
];