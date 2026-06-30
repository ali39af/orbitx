import OpenAI from "openai";
import AIProvider, { type Message, type ChatResponse, type StreamCallback } from "./ai-provider.js";

export class DeepSeekProvider extends AIProvider {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, model: string = "deepseek-v4-flash") {
        super();
        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.deepseek.com"
        });
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
            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages: formattedMessages as any,
                stream: true
            });

            let fullContent = "";
            let inputTokens = 0;
            let outputTokens = 0;

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) {
                    fullContent += content;
                    streamCallback({ role: "assistant", content, done: false });
                }

                if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens || 0;
                    outputTokens = chunk.usage.completion_tokens || 0;
                }
            }

            streamCallback({ role: "assistant", content: "", done: true });
            return {
                content: fullContent,
                inputTokens,
                outputTokens,
            };
        } else {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: formattedMessages as any
            });

            return {
                content: response.choices[0]?.message?.content || "",
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0,
            };
        }
    }
}

export default DeepSeekProvider;