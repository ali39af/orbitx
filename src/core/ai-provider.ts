export interface Message {
    role: "user" | "system" | "assistant" | "tool";
    content?: string;
}

export interface ChatResponse {
    content: string;
    inputTokens: number;
    outputTokens: number;
}

export type StreamCallback = (chunk: {
    role: "assistant" | "tool";
    content: string;
    done: boolean;
}) => void;

export abstract class AIProvider {
    abstract chat(
        messages: Message[],
        streamCallback?: StreamCallback
    ): Promise<ChatResponse>;
}

export default AIProvider;