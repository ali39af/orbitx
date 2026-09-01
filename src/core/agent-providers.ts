import type { AIProvider, ProviderCapabilities, ProviderType } from "./ai-provider.js";

export interface AgentProviderEntry {
    type: ProviderType;
    provider: AIProvider | AIProvider[];
    default?: number;
}

export type AgentProvidersInput = AIProvider | AgentProviderEntry[];

interface ProviderPool {
    providers: AIProvider[];
    default: number;
}

/**
 * Maps the well-known `ProviderType` role names onto the `ProviderCapabilities`
 * flag that actually describes that ability — used only as a fallback when
 * nothing is registered under the role itself (see `getProvider` below).
 * Role names with no capability equivalent (`main`, `llm-low`/`medium`/`high`,
 * any custom string) simply aren't listed here, so the fallback never applies
 * to them.
 */
const CAPABILITY_BY_TYPE: Partial<Record<ProviderType, keyof ProviderCapabilities>> = {
    "image-describer": "supportsImages",
    "image-generation": "supportsImageGeneration",
    "image-editing": "supportsImageEditing",
    "video-describer": "supportsVideo",
    "video-generation": "supportsVideoGeneration",
    "video-editing": "supportsVideoEditing",
    "audio-describer": "supportsAudio",
    "audio-generation": "supportsAudioGeneration",
    "audio-design": "supportsAudioDesign",
    "audio-clone": "supportsAudioClone",
    "3d-model-generator": "supports3DModelGeneration",
};

export class ProviderRegistry {
    #byType: Map<ProviderType, ProviderPool>;

    constructor(byType: Map<ProviderType, ProviderPool>) {
        this.#byType = byType;
    }

    getMain(): AIProvider {
        return this.#byType.get("main")!.providers[this.#byType.get("main")!.default];
    }

    getProvider(type: ProviderType): AIProvider | undefined {
        const pool = this.#byType.get(type);
        if (pool) return pool.providers[pool.default];

        const capabilityKey = CAPABILITY_BY_TYPE[type];
        if (!capabilityKey) return undefined;

        for (const otherPool of this.#byType.values()) {
            for (const provider of otherPool.providers) {
                if (provider.getCapabilities()[capabilityKey]) {
                    return provider;
                }
            }
        }

        return undefined;
    }

    getProviders(type: ProviderType): AIProvider[] | undefined {
        return this.#byType.get(type)?.providers;
    }
}

function toPool(entry: AgentProviderEntry): ProviderPool {
    const providers = Array.isArray(entry.provider) ? entry.provider : [entry.provider];
    const defaultIndex = entry.default ?? 0;
    if (defaultIndex < 0 || defaultIndex >= providers.length) {
        throw new Error(`resolveAgentProviders: entry "${entry.type}" has default=${defaultIndex}, out of range for its ${providers.length}-provider pool.`);
    }
    return { providers, default: defaultIndex };
}

export function resolveAgentProviders(input: AgentProvidersInput): ProviderRegistry {
    const entries: AgentProviderEntry[] = Array.isArray(input) ? input : [{ type: "main", provider: input }];

    const mainEntries = entries.filter(e => e.type === "main");
    if (mainEntries.length === 0) {
        throw new Error("resolveAgentProviders: a provider with type \"main\" is required when passing an array of providers.");
    }

    const byType = new Map<ProviderType, ProviderPool>();
    for (const entry of entries) {
        byType.set(entry.type, toPool(entry));
    }

    return new ProviderRegistry(byType);
}

export default resolveAgentProviders;
