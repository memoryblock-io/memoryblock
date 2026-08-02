/**
 * Auth CRUD handlers for the /api/auth endpoints.
 *
 * GET    /api/auth              — list all providers with masked keys
 * GET    /api/auth/:provider    — read one provider's auth (still masked)
 * PUT    /api/auth/:provider    — update one provider's auth (body has new values)
 * DELETE /api/auth/:provider    — clear one provider's auth
 *
 * Security: secret fields (apiKey, accessKeyId, secretAccessKey, botToken)
 * are returned masked. Clients that PUT a value get the value back; clients
 * that PUT `null` for a secret field clear it.
 */
import { loadAuth, saveAuth, isInitialized, getAuthPath } from '@memoryblock/core';

const SUPPORTED_PROVIDERS = ['aws', 'openai', 'google', 'anthropic', 'ollama', 'telegram', 'brave'] as const;
type Provider = typeof SUPPORTED_PROVIDERS[number];

/** Mask a secret value. Keeps first 3 and last 2 chars if long enough. */
function mask(value: string | undefined | null): string {
    if (!value) return '';
    if (value.length <= 6) return '••••';
    return `${value.slice(0, 3)}${'•'.repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`;
}

/** Mask every secret field in a provider's auth record. */
function maskRecord(rec: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!rec) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
        if (typeof v === 'string') {
            // Heuristic: anything named like a secret gets masked; region/baseURL don't.
            const isSecret = /key|token|secret|password/i.test(k);
            out[k] = isSecret ? mask(v) : v;
        } else {
            out[k] = v;
        }
    }
    return out;
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            ...extra,
        },
    });
}

function error(status: number, message: string): Response {
    return json({ error: message, status }, status);
}

export async function handleGetAuth(): Promise<Response> {
    if (!await isInitialized()) {
        return error(503, 'Workspace not initialized. Run `mblk init` first.');
    }
    const auth = await loadAuth();
    const masked: Record<string, unknown> = {};
    for (const k of Object.keys(auth)) {
        const prov = (auth as any)[k];
        if (prov && typeof prov === 'object') {
            masked[k] = maskRecord(prov);
        } else {
            masked[k] = prov;
        }
    }
    return json({ auth: masked, providers: SUPPORTED_PROVIDERS });
}

export async function handleGetProviderAuth(provider: string): Promise<Response> {
    if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
        return error(404, `Unknown provider: '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    const auth = await loadAuth();
    const rec = (auth as any)[provider] || {};
    return json({ provider, auth: maskRecord(rec) });
}

export async function handleUpdateProviderAuth(provider: string, body: any): Promise<Response> {
    if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
        return error(404, `Unknown provider: '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    if (!body || typeof body !== 'object') {
        return error(400, 'Request body must be a JSON object with auth fields.');
    }
    const auth = await loadAuth() as Record<string, Record<string, string>>;
    const current = auth[provider] || {};

    // For each field in the body:
    //   - null  → clear the field
    //   - "..." → skip (no change)
    //   - "value" → set to value
    const updates = body as Record<string, string | null | undefined>;
    const next: Record<string, string> = { ...current };

    for (const [k, v] of Object.entries(updates)) {
        if (v === null) {
            delete next[k];
        } else if (v === '...' || v === undefined) {
            // no change
        } else if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed === '') {
                delete next[k];
            } else {
                next[k] = trimmed;
            }
        }
    }

    auth[provider] = next;
    await saveAuth(auth as any);

    // Return the masked view so the client can confirm what was saved
    return json({ provider, auth: maskRecord(next), saved: true });
}

export async function handleDeleteProviderAuth(provider: string): Promise<Response> {
    if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
        return error(404, `Unknown provider: '${provider}'.`);
    }
    const auth = await loadAuth() as Record<string, unknown>;
    delete auth[provider];
    await saveAuth(auth as any);
    return json({ provider, deleted: true });
}

/** Helper: read the raw auth.json path. Used by tests/debugging only. */
export async function handleGetAuthRawPath(): Promise<Response> {
    return json({ path: getAuthPath() });
}