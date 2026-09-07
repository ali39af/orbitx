import { AIProvider } from "../../index.js";
import type { ChatResponse, Message, ProviderCapabilities, StreamCallback, ToolSchema } from "../../index.js";

export interface ScriptedResult {
    content?: string;
    toolCalls?: { name: string; inputs: Record<string, any> }[];
    /** Hold the "model" here for a moment, so a test can get a second call in while this turn is still running. */
    delayMs?: number;
}

export type ScriptedTurn = (context: { messages: Message[]; call: number }) => ScriptedResult;

/**
 * A provider that answers from a script instead of a model, so swarm behavior
 * can be tested without a network call.
 *
 * It streams each tool call before returning, exactly as the real providers do,
 * so anything watching the stream (SwarmBase tags every chunk with the agent that
 * produced it) sees what it would see in a real run.
 */
export class ScriptedProvider extends AIProvider {
    #name: string;
    #turn: ScriptedTurn;
    #calls = 0;
    #ids = 0;

    constructor(name: string, script: ScriptedTurn | ScriptedTurn[]) {
        super();
        this.#name = name;
        this.#turn = Array.isArray(script)
            ? ({ messages, call }) => (script[call] ?? (() => ({ content: "(no script left)" })))({ messages, call })
            : script;
    }

    getModel(): string {
        return `scripted-${this.#name}`;
    }

    async chat(
        messages: Message[],
        streamCallback?: StreamCallback,
        _tools?: ToolSchema[],
        _signal?: AbortSignal
    ): Promise<ChatResponse> {
        const call = this.#calls++;
        const result = this.#turn({ messages, call });

        if (result.delayMs) {
            await new Promise(resolve => setTimeout(resolve, result.delayMs));
        }

        const toolCalls = (result.toolCalls ?? []).map(tc => ({
            id: `${this.#name}-call-${++this.#ids}`,
            name: tc.name,
            inputs: tc.inputs,
        }));

        const usage = { inputMissTokens: 1, inputCacheTokens: 0, outputTokens: 1 };
        for (const toolCall of toolCalls) {
            await streamCallback?.({ role: "assistant", content: "", done: false, toolCalls: [toolCall], usage });
        }

        const content = result.content ?? "";
        if (content) {
            await streamCallback?.({ role: "assistant", content, done: false, usage });
        }
        await streamCallback?.({ role: "assistant", content: "", done: true, usage });

        return {
            content,
            inputMissTokens: 1,
            inputCacheTokens: 0,
            outputTokens: 1,
            ...(toolCalls.length ? { toolCalls } : {}),
        };
    }

    getCapabilities(): ProviderCapabilities {
        return { supportsTools: true, supportsImages: false, contextWindow: 200000, safeUsageRatio: 0.5 };
    }

    setOption(): void { }

    getCallCount(): number {
        return this.#calls;
    }
}

/** The parsed output of the most recent result for `toolName`, as the model would read it. */
export function lastToolOutput(messages: Message[], toolName: string): any {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === "tool" && message.toolName === toolName) {
            try {
                return JSON.parse(message.content ?? "{}");
            } catch {
                return { raw: message.content };
            }
        }
    }
    return undefined;
}

/** Text of the newest user-role message — how a delivered task, report, or group message arrives. */
export function lastUserMessage(messages: Message[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i].content ?? "";
    }
    return "";
}

export default ScriptedProvider;
