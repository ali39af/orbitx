import { Ollama } from "ollama";
import AIProvider, { type Message, type ChatResponse, type StreamCallback } from "./ai-provider.js";

export class OllamaProvider extends AIProvider {
    private client: Ollama;
    private model: string;

    constructor(model: string, host: string = "http://localhost:11434") {
        super();
        this.client = new Ollama({ host });
        this.model = model;
    }

    async chat(
        messages: Message[],
        streamCallback?: StreamCallback
    ): Promise<ChatResponse> {
        const formattedMessages = messages.map(msg => ({
            role: msg.role,
            content: msg.content || ""
        }));

        if (streamCallback) {
            const stream = await this.client.chat({
                model: this.model,
                messages: formattedMessages as any,
                stream: true
            });

            let fullContent = "";
            let promptEvalCount = 0;
            let evalCount = 0;

            for await (const chunk of stream) {
                const content = chunk.message?.content || "";
                if (content) {
                    fullContent += content;
                    streamCallback({ role: "assistant", content, done: false });
                }

                if (chunk.prompt_eval_count !== undefined) {
                    promptEvalCount = chunk.prompt_eval_count;
                }
                if (chunk.eval_count !== undefined) {
                    evalCount = chunk.eval_count;
                }
            }

            streamCallback({ role: "assistant", content: "", done: true });
            return {
                content: fullContent,
                inputTokens: promptEvalCount,
                outputTokens: evalCount
            };
        } else {
            const response = await this.client.chat({
                model: this.model,
                messages: formattedMessages as any
            });

            return {
                content: response.message?.content || "",
                inputTokens: response.prompt_eval_count || 0,
                outputTokens: response.eval_count || 0
            };
        }
    }
}

export default OllamaProvider;