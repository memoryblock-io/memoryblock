/**
 * `@memoryblock/adapters` — single-file bridge to aiplug.
 *
 * This package used to ship per-provider folders (`openai/`, `anthropic/`,
 * `google/`, `ollama/`, `bedrock/`) — every one of those folders was a
 * hand-written fetch+conversion layer per provider, plus the AWS SDK
 * dependency for Bedrock Converse.
 *
 * That whole surface has been collapsed. **All provider implementations
 * live in aiplug now.** This file exists only to:
 *
 *   1. Re-export the public type surface that downstream packages already
 *      import (`LLMAdapter`, `LLMMessage`, `LLMResponse`,
 *      `LLMAdapterToolDefinition` aliased as `ToolDefinition`).
 *
 *   2. Provide one factory — `createMemoryAdapter` — that:
 *        - resolves per-provider auth from environment variables
 *        - normalises Bedrock vs OpenAI-style providers vs Ollama
 *        - builds an aiplug `LLMAdapter` and exposes it through the
 *          `LLMAdapter` interface memoryblock already uses
 *
 *   3. Re-export the Ollama daemon helpers (`isOllamaAvailable`,
 *      `listOllamaModels`) because aiplug has no equivalent yet.
 *
 * If you find yourself wanting to import a named `OpenAIAdapter` (or
 * similar) from this package, the answer is: don't. Build one through
 * `createMemoryAdapter({ provider: 'openai', … })` and the rest of the
 * pipeline just works.
 */
import {
    AIPlug,
    type AiplugConfig,
    type ChatRequest,
    type ToolCall as AIPlugToolCall,
    createLLMAdapter,
    type LLMAdapter,
} from 'aiplug';

/* ---------------------------------------------------------------------------
 * Public types — re-exports of the canonical aiplug types. Existing import
 * paths (`@memoryblock/adapters` → `LLMAdapter`, `LLMMessage`,
 * `ToolDefinition`) keep working unchanged.
 * ------------------------------------------------------------------------- */

export type {
    LLMAdapter,
    LLMMessage,
    LLMResponse,
    LLMAdapterToolDefinition as ToolDefinition,
    TokenUsage,
    StopReason,
    MessageRole,
} from 'aiplug';

/* ---------------------------------------------------------------------------
 * Configuration accepted by `createMemoryAdapter`.
 *
 * The shape is provider-driven: unknown fields are silently ignored by
 * the underlying transport, so callers can spread a chat-config without
 * branching.
 * ------------------------------------------------------------------------- */

export interface MemoryAdapterConfig {
    /** aiplug provider slug (e.g. `'openai'`, `'anthropic'`, `'bedrock'`). */
    provider: string;
    model: string;

    /** Bearer-style API key. Falls back to provider-specific env vars. */
    apiKey?: string;
    /** Optional override of the upstream base URL. */
    baseURL?: string;
    /** Optional sampling hint forwarded via `sampling.maxTokens`. */
    maxTokens?: number;

    /** Provider-specific extras (e.g. AWS for Bedrock). */
    providerOptions?: {
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        [k: string]: unknown;
    };
}

/* ---------------------------------------------------------------------------
/* ---------------------------------------------------------------------------
 * Provider-slug -> aiplug-slug aliasing.
 *
 * Kept as a one-entry-per-provider map (instead of `if (x === 'foo')`)
 * so adding a new alias is a single-line change. Today only the
 * `google` <-> `gemini` <-> `google-ai-studio` triangle needs explicit
 * aliasing - the rest pass through unchanged.
 * --------------------------------------------------------------------------- */

const AIPLUG_SLUG_ALIAS: Record<string, string> = {
    google: 'google-ai-studio',
    gemini: 'google-ai-studio',
};

function toAIPlugProviderSlug(provider: string): string {
    const aliased: string | undefined = AIPLUG_SLUG_ALIAS[provider];
    return aliased ?? provider;
}

/* ---------------------------------------------------------------------------
 * Auth resolution - aiplug-schema driven, no hardcoded provider branches.
 *
 * Reads the provider's auth requirement from aiplug's introspection API
 * to decide whether a key is needed. Falls back to the canonical bearer
 * shape when aiplug isn't available or the provider isn't registered.
 * --------------------------------------------------------------------------- */

function resolveAuth(
    provider: string,
    config: MemoryAdapterConfig,
): { apiKey?: string; baseURL?: string } {
    const out: { apiKey?: string; baseURL?: string } = {};
    const descriptor = safeDescribe(provider);
    const requiresKey = descriptor?.auth === 'bearer' || descriptor?.auth === 'x-api-key';

    const slugEnv = `${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`;
    const legacyEnv = LEGACY_PROVIDER_ENV[provider];
    const apiKey = config.apiKey
        ?? process.env[slugEnv]
        ?? (legacyEnv ? process.env[legacyEnv] : undefined);

    if (apiKey) {
        out.apiKey = apiKey;
    } else if (!requiresKey) {
        // Keyless local transport - synthesise a non-secret placeholder
        // so the OpenAI-shaped aiplug transport doesn't reject the request.
        out.apiKey = `${provider}-local`;
    }

    if (config.baseURL) out.baseURL = config.baseURL;
    return out;
}

/**
 * Legacy env-var aliases for the original five hardcoded providers. Kept
 * so existing `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` etc. continue to
 * work without users having to rename to `<SLUG>_API_KEY`. New auth
 * should use the slug-named env var or pass `config.apiKey` directly.
 */
const LEGACY_PROVIDER_ENV: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    gemini: 'GEMINI_API_KEY',
};

function safeDescribe(provider: string): { auth?: string; defaultBaseURL?: string | null } | undefined {
    try {
        return AIPlug.describeProvider(provider) as { auth?: string; defaultBaseURL?: string | null };
    } catch {
        return undefined;
    }
}

/* ---------------------------------------------------------------------------
 * `createMemoryAdapter` — the one factory every consumer should use.
 *
 * Returns an `LLMAdapter` that:
 *   - speaks the exact memoryblock message/response shape
 *   - streams tool calls and text-deltas via `onChunk`
 *   - emits typed errors from aiplug (`AIPlugError.code`)
 * ------------------------------------------------------------------------- */

export function createMemoryAdapter(config: MemoryAdapterConfig): LLMAdapter {
    const auth = resolveAuth(config.provider, config);
    const descriptor = safeDescribe(config.provider);
    const slug: string = toAIPlugProviderSlug(config.provider);

    // Default base URL: prefer config.baseURL, then the descriptor's
    // canonical defaultBaseURL (with region placeholder resolved), then
    // providerOptions.baseURL. Provider-specific branches live elsewhere.
    let baseURL: string | undefined = auth.baseURL;
    if (!baseURL && descriptor?.defaultBaseURL) {
        const defaultBaseURL: string = descriptor.defaultBaseURL;
        const region = config.providerOptions?.region;
        baseURL = region && defaultBaseURL.includes('<region>')
            ? defaultBaseURL.replace(/<region>/g, region)
            : defaultBaseURL;
    }
    if (!baseURL && typeof config.providerOptions?.baseURL === 'string') {
        baseURL = config.providerOptions.baseURL;
    }

    if (!auth.apiKey) {
        throw new Error(
            `${config.provider} adapter misconfigured: API key is missing for the active adapter.`,
        );
    }

    const aiplugConfig: AiplugConfig = {
        transport: slug,
        model: config.model,
        ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
    };

    // Forward provider-shaped fields (region, accessKeyId, secretAccessKey,
    // sessionToken, headers) into aiplug's providerOptions bag. Each
    // transport picks the ones it understands.
    const forwardedOptions: Record<string, unknown> = {};
    if (config.providerOptions) {
        for (const [k, v] of Object.entries(config.providerOptions)) {
            if (k === 'baseURL') continue;
            if (typeof v === 'string' && v.length > 0) forwardedOptions[k] = v;
        }
    }
    if (Object.keys(forwardedOptions).length > 0) {
        aiplugConfig.providerOptions = forwardedOptions;
    }

    return createLLMAdapter({
        provider: slug,
        model: config.model,
        ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
        options: aiplugConfig,
    });
}

/* ---------------------------------------------------------------------------
 * Static helpers — currently just the Ollama discovery helpers, which no
 * aiplug-equivalent exists for yet.
 * ------------------------------------------------------------------------- */

export async function isOllamaAvailable(
    baseURL = 'http://localhost:11434',
    timeoutMs = 2000,
): Promise<boolean> {
    const url = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

export async function listOllamaModels(
    baseURL = 'http://localhost:11434',
    timeoutMs = 5000,
): Promise<string[]> {
    const url = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return [];
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        return (data.models || []).map((m) => m.name);
    } catch {
        return [];
    }
}

// Re-export the small surface pieces callers may want when constructing
// requests in the same shape aiplug uses (`ChatRequest`). This is not
// strictly required — `createMemoryAdapter` already does the conversion
// — but is exposed for completeness.
export type { AIPlug, AiplugConfig, ChatRequest, AIPlugToolCall };