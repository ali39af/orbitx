import type { AIProvider, MessageContentPart } from "./ai-provider.js";

export class ImageDescriber {
    #provider: AIProvider;

    constructor(provider: AIProvider) {
        this.#provider = provider;
    }

    /**
     * @param image base64-encoded image bytes (no data: prefix)
     * @param mimeType e.g. "image/png"
     * @param focusHint what the calling agent wants the description to pay attention to
     */
    async describe(image: string, mimeType: string = "image/png", focusHint?: string): Promise<string> {
        const caps = this.#provider.getCapabilities();
        if (!caps.supportsImages) {
            throw new Error(
                "ImageDescriber's provider does not support image input (getCapabilities().supportsImages is false) — " +
                "configure ImageDescriber with a vision-capable provider."
            );
        }

        const parts: MessageContentPart[] = [
            {
                type: "text",
                text: focusHint
                    ? `Describe this image concisely for another AI agent that cannot see it. Focus specifically on: ${focusHint}`
                    : "Describe this image concisely for another AI agent that cannot see it. Mention layout, visible text, colors, and anything that looks unusual or broken.",
            },
            { type: "image", image, mimeType },
        ];

        const response = await this.#provider.chat([
            { role: "user", parts },
        ]);

        return response.content;
    }
}

export default ImageDescriber;
