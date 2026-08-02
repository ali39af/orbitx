import type { AIProvider } from "./ai-provider.js";

export type AgentProviderRole = "main" | "image";

export interface AgentProviderEntry {
    aiProvider: AIProvider;
    type: AgentProviderRole;
}

export type AgentProvidersInput = AIProvider | AgentProviderEntry[];

export interface ResolvedAgentProviders {
    main: AIProvider;
    /** Present only if a provider was assigned the "image" role, or (single-provider case) the one provider supports images. */
    image?: AIProvider;
}

/** Only two provider roles exist: "main" (the agent loop itself) and "image" (describing/handling image tool output). There is no separate "utils" provider — all skills and tools are always included in the system prompt from the start, so there's nothing left for a utils pass to decide. */
export function resolveAgentProviders(input: AgentProvidersInput): ResolvedAgentProviders {
    if (!Array.isArray(input)) {
        const caps = input.getCapabilities();
        return {
            main: input,
            image: caps.supportsImages ? input : undefined,
        };
    }

    const mainEntry = input.find(e => e.type === "main");
    if (!mainEntry) {
        throw new Error("resolveAgentProviders: a provider with type \"main\" is required when passing an array of providers.");
    }

    const imageEntry = input.find(e => e.type === "image");

    return {
        main: mainEntry.aiProvider,
        image: imageEntry?.aiProvider,
    };
}

export default resolveAgentProviders;
