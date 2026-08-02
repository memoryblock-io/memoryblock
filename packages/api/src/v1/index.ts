/**
 * /v1 — Public memoryblock API surface.
 *
 * Designed for external apps that want to plug memoryblock in as their
 * unified LLM gateway. The four endpoints are the only ones an app needs
 * to know about:
 *
 *   GET  /v1/health
 *   GET  /v1/adapters
 *   GET  /v1/adapters/:provider/models
 *   POST /v1/adapters/:provider/verify
 *   POST /v1/chat
 *
 * Auth: all /v1 routes (except /v1/health) require the same bearer token
 * the daemon already issues via `mblk server token`.
 *
 * Streaming: /v1/chat responds with `text/event-stream` SSE frames when
 * `stream: true` is set in the body, otherwise plain JSON.
 */
import { Router, type RouterRequest, type RouteParams } from '../router.js';
import {
    ADAPTER_REGISTRY,
    listAdapters,
    listModelsForAdapter,
    verifyAdapter,
    createAdapter,
    AdapterNotFoundError,
    AdapterConfigError,
    type ChatRequest,
} from '../adapter-registry.js';

const API_VERSION = '1.0.0';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'X-API-Version': API_VERSION,
        },
    });
}

function error(status: number, message: string, code?: string): Response {
    return json({ error: message, status, code: code || null }, status);
}

/** Validate the body of POST /v1/chat. */
function validateChatRequest(body: unknown): { ok: true; req: ChatRequest } | { ok: false; message: string } {
    if (!body || typeof body !== 'object') {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const b = body as Partial<ChatRequest>;
    if (!b.adapter || typeof b.adapter !== 'string') {
        return { ok: false, message: "Missing required field 'adapter' (one of: " + listAdapters().join(', ') + ').' };
    }
    if (!(b.adapter in ADAPTER_REGISTRY)) {
        return { ok: false, message: `Unknown adapter '${b.adapter}'. Supported: ${listAdapters().join(', ')}.` };
    }
    if (!b.model || typeof b.model !== 'string') {
        return { ok: false, message: "Missing required field 'model'." };
    }
    if (!Array.isArray(b.messages) || b.messages.length === 0) {
        return { ok: false, message: "Field 'messages' must be a non-empty array." };
    }
    for (const m of b.messages) {
        if (!m || typeof m !== 'object') return { ok: false, message: 'Each message must be an object.' };
        if (!['system', 'user', 'assistant', 'tool'].includes(m.role as string)) {
            return { ok: false, message: `Invalid role '${m.role}'.` };
        }
    }
    if (b.tools !== undefined && !Array.isArray(b.tools)) {
        return { ok: false, message: "Field 'tools' must be an array when present." };
    }
    return { ok: true, req: b as ChatRequest };
}

/** Serialize messages from the chat body into the LLMMessage[] shape adapters expect. */
function normalizeMessages(req: ChatRequest) {
    return req.messages.map((m) => {
        const out: any = { role: m.role };
        if (m.content !== undefined) out.content = m.content;
        if (m.toolCalls) out.toolCalls = m.toolCalls;
        if (m.toolResults) out.toolResults = m.toolResults;
        return out;
    });
}

export const v1Router = new Router();

// ─── Health ──────────────────────────────────────────────
v1Router.get('/v1/health', async () => {
    return json({
        status: 'ok',
        version: API_VERSION,
        adapters: listAdapters(),
    });
});

// ─── List adapters ───────────────────────────────────────
v1Router.get('/v1/adapters', async () => {
    return json({
        adapters: Object.values(ADAPTER_REGISTRY).map((info) => ({
            id: info.id,
            displayName: info.displayName,
            authRequired: info.authRequired,
            defaultBaseURL: info.defaultBaseURL || null,
            defaultModel: info.defaultModel,
            supportsStreaming: info.supportsStreaming,
            envVars: info.envVars || [],
        })),
    });
});

// ─── List models for an adapter ──────────────────────────
v1Router.get('/v1/adapters/:provider/models', async (_req: RouterRequest, params: RouteParams) => {
    try {
        const models = await listModelsForAdapter(params.provider);
        return json({ provider: params.provider, models, count: models.length });
    } catch (err) {
        if (err instanceof AdapterNotFoundError) return error(404, err.message, 'ADAPTER_NOT_FOUND');
        return error(500, (err as Error).message);
    }
});

// ─── Verify an adapter's credentials / reachability ──────
v1Router.post('/v1/adapters/:provider/verify', async (req: RouterRequest) => {
    const body = await req.json().catch(() => ({})) as { provider?: string; config?: any };
    const provider = body.provider || (req as any).params?.provider;
    if (!provider || !(provider in ADAPTER_REGISTRY)) {
        return error(400, `Unknown or missing 'provider'. Supported: ${listAdapters().join(', ')}`);
    }
    const cfg = (body.config || {}) as Record<string, unknown>;
    const result = await verifyAdapter(provider, cfg as any);
    return json({ provider, ...result }, result.ok ? 200 : 503);
});

// ─── The single inference endpoint ───────────────────────
v1Router.post('/v1/chat', async (req: RouterRequest) => {
    let parsed: unknown;
    try {
        parsed = await req.json();
    } catch {
        return error(400, 'Invalid JSON body.');
    }
    const validation = validateChatRequest(parsed);
    if (!validation.ok) {
        return error(400, validation.message, 'INVALID_REQUEST');
    }
    const body = validation.req;

    let adapter;
    try {
        adapter = await createAdapter(body.adapter, body.config || {});
    } catch (err) {
        if (err instanceof AdapterNotFoundError) return error(404, err.message, 'ADAPTER_NOT_FOUND');
        if (err instanceof AdapterConfigError) return error(503, err.message, 'ADAPTER_CONFIG_ERROR');
        return error(500, (err as Error).message);
    }

    // Inject the requested model into the adapter instance.
    (adapter as any).model = body.model;

    const messages = normalizeMessages(body);
    const tools = body.tools as any[] | undefined;

    // ── Streaming response via Server-Sent Events ──
    if (body.stream) {
        if (typeof (adapter as any).converseStream !== 'function') {
            return error(400, `Adapter '${body.adapter}' does not support streaming.`, 'STREAM_UNSUPPORTED');
        }
        const stream = new ReadableStream({
            async start(controller) {
                const enc = new TextEncoder();
                const send = (event: string, data: unknown) => {
                    controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                };
                try {
                    send('start', { provider: body.adapter, model: body.model });
                    const res = await (adapter as any).converseStream(messages, tools, (chunk: string) => {
                        send('content', { text: chunk });
                    });
                    send('done', { usage: res.usage, stopReason: res.stopReason });
                    controller.close();
                } catch (err) {
                    send('error', { message: (err as Error).message });
                    controller.close();
                }
            },
        });
        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'X-API-Version': API_VERSION,
            },
        });
    }

    // ── Non-streaming JSON response ──
    try {
        const res = await adapter.converse(messages, tools);
        return json({
            provider: body.adapter,
            model: body.model,
            message: res.message,
            usage: res.usage,
            stopReason: res.stopReason,
        });
    } catch (err) {
        return error(502, (err as Error).message, 'ADAPTER_ERROR');
    }
});
