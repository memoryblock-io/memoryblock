/**
 * Adapter registry — single source of truth for the /v1 API surface.
 *
 * Maps provider ids to adapter factories. Each factory reads the user's
 * `auth.json` for default credentials and accepts a per-request `config`
 * object that overrides any of them. This is the same shape the /v1/chat
 * endpoint receives in its `config` field.
 *
 * The 5 registered adapters match the 5 selected for Phase 1:
 *   - bedrock    (AWS — Claude, Llama)
 *   - openai     (OpenAI API)
 *   - google     (Google Gemini via OpenAI-compat endpoint)
 *   - anthropic  (Anthropic API direct)
 *   - ollama     (local model server, no auth)
 */
import { loadAuth } from '@memoryblock/core';
import type { LLMAdapter } from '@memoryblock/types';
import type { MemoryAdapterConfig } from '@memoryblock/adapters';

export type AdapterId = 'bedrock' | 'openai' | 'google' | 'anthropic' | 'ollama';

export interface AdapterInfo {
    id: AdapterId;
    displayName: string;
    authRequired: boolean;
    defaultBaseURL?: string;
    envVars?: string[];
    defaultModel: string;
    /** Whether the adapter has a `converseStream` implementation. */
    supportsStreaming: boolean;
}

export const ADAPTER_REGISTRY: Record<AdapterId, AdapterInfo> = {
    bedrock: {
        id: 'bedrock',
        displayName: 'AWS Bedrock',
        authRequired: true,
        defaultModel: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        supportsStreaming: true,
    },
    openai: {
        id: 'openai',
        displayName: 'OpenAI',
        authRequired: true,
        defaultBaseURL: 'https://api.openai.com/v1',
        envVars: ['OPENAI_API_KEY'],
        defaultModel: 'gpt-4o-mini',
        supportsStreaming: true,
    },
    google: {
        id: 'google',
        displayName: 'Google Gemini',
        authRequired: true,
        defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        envVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        defaultModel: 'gemini-2.5-flash',
        supportsStreaming: true,
    },
    anthropic: {
        id: 'anthropic',
        displayName: 'Anthropic',
        authRequired: true,
        defaultBaseURL: 'https://api.anthropic.com/v1/messages',
        envVars: ['ANTHROPIC_API_KEY'],
        defaultModel: 'claude-3-5-sonnet-20241022',
        supportsStreaming: true,
    },
    ollama: {
        id: 'ollama',
        displayName: 'Ollama (local)',
        authRequired: false,
        defaultBaseURL: 'http://localhost:11434/v1',
        envVars: ['OLLAMA_BASE_URL'],
        defaultModel: 'llama3.2',
        supportsStreaming: true,
    },
};

/**
 * The shape the /v1/chat endpoint accepts in its `config` field.
 * All fields are optional and override the defaults from `auth.json`.
 */
export interface ChatConfig {
    maxTokens?: number;
    temperature?: number;
    cacheControl?: boolean;
    /** Bedrock only. */
    region?: string;
    /** OpenAI / Google / Anthropic / Ollama — API base URL. */
    baseURL?: string;
    /** Per-request API key override. */
    apiKey?: string;
    /** Bedrock only. */
    accessKeyId?: string;
    /** Bedrock only. */
    secretAccessKey?: string;
}

export interface ChatRequest {
    adapter: AdapterId;
    model: string;
    messages: Array<{
        role: 'system' | 'user' | 'assistant' | 'tool';
        content?: string;
        toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
        toolResults?: Array<{ toolCallId: string; name: string; content: string; isError?: boolean }>;
    }>;
    tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        requiresApproval?: boolean;
    }>;
    stream?: boolean;
    config?: ChatConfig;
}

export class AdapterNotFoundError extends Error {
    constructor(provider: string) {
        super(`Unknown adapter: '${provider}'. Supported: ${Object.keys(ADAPTER_REGISTRY).join(', ')}`);
        this.name = 'AdapterNotFoundError';
    }
}

export class AdapterConfigError extends Error {
    constructor(provider: string, detail: string) {
        super(`${provider} adapter misconfigured: ${detail}`);
        this.name = 'AdapterConfigError';
    }
}

/**
 * Build an adapter instance from a provider id and per-request config.
 * Reads the user's `auth.json` for default credentials; per-request `config`
 * fields override them.
 *
 * All real provider work is routed through `createMemoryAdapter`. There
 * are no per-provider classes here; `@memoryblock/adapters` is a single
 * aiplug-backed factory.
 */
export async function createAdapter(provider: string, cfg: ChatConfig = {}): Promise<LLMAdapter> {
    const id = provider as AdapterId;
    const info = ADAPTER_REGISTRY[id];
    if (!info) throw new AdapterNotFoundError(provider);

    const { createMemoryAdapter } = await import('@memoryblock/adapters');
    const auth = await loadAuth();

    const model = info.defaultModel;
    const providerOptions: NonNullable<MemoryAdapterConfig['providerOptions']> = {};

    if (id === 'bedrock') {
        const accessKeyId = cfg.accessKeyId || auth.aws?.accessKeyId;
        const secretAccessKey = cfg.secretAccessKey || auth.aws?.secretAccessKey;
        const region = cfg.region || auth.aws?.region || 'us-east-1';
        if (info.authRequired && (!accessKeyId || !secretAccessKey)) {
            throw new AdapterConfigError('bedrock', 'AWS credentials missing. Set aws.accessKeyId and aws.secretAccessKey in auth.json or pass them in config.');
        }
        providerOptions.region = region;
        providerOptions.accessKeyId = accessKeyId;
        providerOptions.secretAccessKey = secretAccessKey;
        // aiplug's bedrock entry uses Bearer-style auth with the AWS key
        // concatenation. We pass that through `apiKey` so user code does
        // not have to learn a second auth scheme.
        const apiKey = accessKeyId && secretAccessKey
            ? `${accessKeyId}:${secretAccessKey}`
            : undefined;
        return createMemoryAdapter({
            provider: 'bedrock',
            model,
            ...(apiKey ? { apiKey } : {}),
            ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
            maxTokens: cfg.maxTokens || 4096,
            providerOptions,
        });
    }

    if (id === 'openai') {
        const apiKey = cfg.apiKey || auth.openai?.apiKey;
        if (info.authRequired && !apiKey) {
            throw new AdapterConfigError('openai', 'API key missing. Set openai.apiKey in auth.json or pass it in config.');
        }
        return createMemoryAdapter({
            provider: 'openai',
            model,
            apiKey: apiKey || 'sk-missing',
            ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
            maxTokens: cfg.maxTokens || 4096,
            providerOptions,
        });
    }

    if (id === 'google') {
        const apiKey = cfg.apiKey || auth.google?.apiKey || auth.gemini?.apiKey;
        if (info.authRequired && !apiKey) {
            throw new AdapterConfigError('google', 'API key missing. Set google.apiKey in auth.json or pass it in config.');
        }
        return createMemoryAdapter({
            provider: 'google',
            model,
            apiKey: apiKey || 'AIza-missing',
            ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
            maxTokens: cfg.maxTokens || 8192,
            providerOptions,
        });
    }

    if (id === 'anthropic') {
        const apiKey = cfg.apiKey || auth.anthropic?.apiKey;
        if (info.authRequired && !apiKey) {
            throw new AdapterConfigError('anthropic', 'API key missing. Set anthropic.apiKey in auth.json or pass it in config.');
        }
        return createMemoryAdapter({
            provider: 'anthropic',
            model,
            apiKey: apiKey || 'sk-ant-missing',
            ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
            maxTokens: cfg.maxTokens || 4096,
            providerOptions,
        });
    }

    if (id === 'ollama') {
        return createMemoryAdapter({
            provider: 'ollama',
            model,
            ...(cfg.baseURL ? { baseURL: cfg.baseURL } : (process.env.OLLAMA_BASE_URL ? { baseURL: process.env.OLLAMA_BASE_URL } : {})),
            maxTokens: cfg.maxTokens || 4096,
            providerOptions,
        });
    }

    throw new AdapterNotFoundError(provider);
}

/** List all registered adapter ids. */
export function listAdapters(): AdapterId[] {
    return Object.keys(ADAPTER_REGISTRY) as AdapterId[];
}

/** List available models for an adapter. For keyless local runtimes (Ollama,
 * LM Studio, llama.cpp, vLLM), live-discovers from the daemon. */
export async function listModelsForAdapter(provider: string): Promise<string[]> {
    const info = ADAPTER_REGISTRY[provider as AdapterId];
    if (!info) throw new AdapterNotFoundError(provider);

    if (!info.authRequired) {
        // Keyless local transport — try aiplug's listOllamaModels helper if
        // installed, else return empty (the curated list below is empty too).
        try {
            const { listOllamaModels } = await import('@memoryblock/adapters');
            return await listOllamaModels();
        } catch {
            return [];
        }
    }

    // Curated lists per provider — covers the most-used, well-known models.
    const curated: Record<AdapterId, string[]> = {
        bedrock: [
            'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
            'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            'us.anthropic.claude-3-5-haiku-20241022-v1:0',
            'us.anthropic.claude-3-opus-20240229-v1:0',
            'meta.llama3-1-70b-instruct-v1:0',
            'meta.llama3-1-8b-instruct-v1:0',
            'mistral.mistral-large-2407-v1:0',
        ],
        openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o1', 'o1-mini', 'o3-mini'],
        google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-sonnet-4-20250514'],
        ollama: [], // filled in dynamically above
    };
    return curated[info.id];
}

/**
 * Probe an adapter's credentials / reachability. Never throws — returns
 * `{ ok: boolean, detail: string }` so the /v1/verify endpoint can surface
 * a friendly message.
 *
 * For HTTP-based adapters (Ollama), this just checks the daemon is
 * reachable. For SDK-based adapters (Bedrock), it tries a tiny converse
 * call. We deliberately avoid making real LLM calls for verification —
 * the /v1/chat endpoint is the proper place for that.
 */
export async function verifyAdapter(provider: string, cfg: ChatConfig = {}): Promise<{ ok: boolean; detail: string }> {
    const id = provider as AdapterId;
    const info = ADAPTER_REGISTRY[id];
    if (!info) {
        return { ok: false, detail: `Unknown adapter '${provider}'.` };
    }

    // For Ollama, just probe the daemon. No need to make a real call.
    if (id === 'ollama') {
        try {
            const { isOllamaAvailable, listOllamaModels } = await import('@memoryblock/adapters');
            const base = cfg.baseURL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
            const reachable = await isOllamaAvailable(base);
            if (reachable) {
                const models = await listOllamaModels(base);
                return {
                    ok: true,
                    detail: `Ollama daemon reachable at ${base}. ${models.length} model(s) available.`,
                };
            }
            return { ok: false, detail: `Ollama daemon not reachable at ${base}. Start it with: ollama serve` };
        } catch (err) {
            return { ok: false, detail: (err as Error).message };
        }
    }

    // For SDK-based adapters (Bedrock), try to instantiate and ping.
    try {
        const adapter = await createAdapter(provider, cfg);
        // The verify just needs to confirm the adapter can be constructed
        // and creds work. We use the adapter's default model.
        (adapter as any).model = (cfg as any).model || info.defaultModel;
        await adapter.converse(
            [{ role: 'user', content: 'ping' }],
            undefined,
        );
        return { ok: true, detail: `${info.displayName} responded to ping with model "${(adapter as any).model}".` };
    } catch (err) {
        const msg = (err as Error).message || String(err);
        // Bedrock's "AccessDenied" or "model not enabled" still means creds are good.
        if (msg.includes('AccessDenied') || msg.includes('not enabled') || msg.includes('on-demand')) {
            return { ok: true, detail: `${info.displayName} credentials are valid, but the model may not be enabled in this account.` };
        }
        return { ok: false, detail: msg };
    }
}
