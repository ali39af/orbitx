import type { MCP } from "../../core/mcp.js";

export interface TodoTask {
    id: string;
    listId: string;
    name: string;
    description?: string;
    checked: boolean;
}

export interface TodoList {
    id: string;
    name: string;
    taskIds: string[];
}

const LISTS_INDEX_KEY = "todo:lists";
const listKey = (id: string) => `todo:list:${id}`;
const taskKey = (id: string) => `todo:task:${id}`;

async function readJSON<T>(mcp: MCP, key: string, fallback: T): Promise<T> {
    const raw = await mcp.getStorage().get(key);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

async function writeJSON(mcp: MCP, key: string, value: unknown): Promise<void> {
    await mcp.getStorage().set(key, JSON.stringify(value));
}

export async function getListIndex(mcp: MCP): Promise<string[]> {
    return readJSON<string[]>(mcp, LISTS_INDEX_KEY, []);
}

export async function setListIndex(mcp: MCP, ids: string[]): Promise<void> {
    await writeJSON(mcp, LISTS_INDEX_KEY, ids);
}

export async function getList(mcp: MCP, id: string): Promise<TodoList | null> {
    return readJSON<TodoList | null>(mcp, listKey(id), null);
}

export async function setList(mcp: MCP, list: TodoList): Promise<void> {
    await writeJSON(mcp, listKey(list.id), list);
}

export async function deleteListKey(mcp: MCP, id: string): Promise<void> {
    // Storage has no delete primitive; clearing to an empty marker is the
    // best available option so stale reads don't resurrect old data.
    await mcp.getStorage().set(listKey(id), "");
}

export async function getTask(mcp: MCP, id: string): Promise<TodoTask | null> {
    return readJSON<TodoTask | null>(mcp, taskKey(id), null);
}

export async function setTask(mcp: MCP, task: TodoTask): Promise<void> {
    await writeJSON(mcp, taskKey(task.id), task);
}

export async function deleteTaskKey(mcp: MCP, id: string): Promise<void> {
    await mcp.getStorage().set(taskKey(id), "");
}
