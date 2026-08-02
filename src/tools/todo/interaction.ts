import { MCPCustomClass } from "../../core/mcp.js";

export type TodoEvent =
    | { type: "list-created"; listId: string; name: string }
    | { type: "list-removed"; listIds: string[] }
    | { type: "task-created"; listId: string; taskIds: string[] }
    | { type: "task-removed"; taskIds: string[] }
    | { type: "task-checked"; taskIds: string[]; checked: boolean };

/**
 * Shared custom interaction class for all todo tools. A frontend can listen
 * on getEvents() to reflect live changes (e.g. re-render a task list the
 * moment the agent checks something off) without polling storage.
 */
export class TodoInteraction extends MCPCustomClass {
    emitTodoEvent(event: TodoEvent) {
        this.getEvents().emit("todo", event);
    }
}

export default TodoInteraction;
