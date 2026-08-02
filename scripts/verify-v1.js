#!/usr/bin/env bun
/**
 * verify-v1.js — Phase 2 verification for the public /v1 API surface.
 *
 * Spins up the ApiServer on an ephemeral port, then exercises the five
 * /v1 endpoints:
 *   - GET  /v1/health            (public, no auth)
 *   - GET  /v1/adapters          (auth)
 *   - GET  /v1/adapters/:id/models (auth)
 *   - POST /v1/adapters/:id/verify (auth)
 *   - POST /v1/chat              (auth, real call to Ollama + Bedrock)
 *
 * Secrets are read from the user's auth.json (gitignored) for the Bedrock
 * test; the Ollama test reuses the local daemon. No credentials are echoed.
 *
 * Run: pnpm dev:verify:v1   |   bun scripts/verify-v1.js
 */

const { spawn } = require('node:child_process');
const { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { homedir, tmpdir } = require('node:os');

const ANSI = {
    reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};

const TINY_MODEL = 'qwen2.5:0.5b';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';

let passCount = 0, failCount = 0, skipCount = 0;
const failures = [];

function pass(name, detail = '') {
    passCount++;
    console.log(`  ${ANSI.green}✓${ANSI.reset} ${name}${detail ? ANSI.dim + ' — ' + detail + ANSI.reset : ''}`);
}
function fail(name, err) {
    failCount++;
    const msg = err && err.message ? err.message : String(err);
    failures.push({ name, err: msg });
    console.log(`  ${ANSI.red}✗${ANSI.reset} ${name}${ANSI.dim} — ${msg}${ANSI.reset}`);
}
function skip(name, reason = '') {
    skipCount++;
    console.log(`  ${ANSI.yellow}○${ANSI.reset} ${name}${ANSI.dim}${reason ? ' — ' + reason : ''}${ANSI.reset}`);
}
function header(text) {
    console.log(`\n${ANSI.cyan}${ANSI.bold}━━━ ${text} ━━━${ANSI.reset}`);
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function loadAuth() {
    const path = join(homedir(), '.memoryblock', 'ws', 'auth.json');
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

async function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(timer); }
}

// ===== Server boot helpers =====

async function findAvailablePort() {
    const net = require('node:net');
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

async function startApiServer() {
    // Use a throwaway workspace so we don't pollute the real one.
    const tempWs = mkdtempSync(join(tmpdir(), 'mblk-v1-'));
    const token = `mblk_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    writeFileSync(join(tempWs, '.api-token'), token, 'utf8');

    const port = await findAvailablePort();
    const { ApiServer } = require('../packages/api/dist/index.js');
    const { v1Router } = require('../packages/api/dist/v1-reexport.js');

    const server = new ApiServer({ port, authToken: token, workspacePath: tempWs });
    server.registerRouter('/v1', v1Router);
    server.allowPublic('/v1/health');

    await server.start();
    return { server, port, token, tempWs };
}

async function stopApiServer(server, tempWs) {
    try { await server.stop(); } catch { /* ignore */ }
    try { rmSync(tempWs, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function http(port, method, path, { token, body } = {}) {
    const url = `http://127.0.0.1:${port}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, text, json };
}

// ===== Tests =====

async function testHealth(port) {
    header('GET /v1/health (public, no auth)');
    try {
        const res = await withTimeout(http(port, 'GET', '/v1/health'), 5000, 'health');
        assert(res.status === 200, `expected 200, got ${res.status}`);
        assert(res.json.status === 'ok', `expected status=ok, got ${res.json.status}`);
        assert(Array.isArray(res.json.adapters), 'expected adapters array');
        assert(res.json.adapters.length === 5, `expected 5 adapters, got ${res.json.adapters.length}`);
        pass('GET /v1/health', `${res.json.adapters.length} adapters: ${res.json.adapters.join(', ')}`);
    } catch (err) {
        fail('GET /v1/health', err);
    }
}

async function testAdaptersList(port, token) {
    header('GET /v1/adapters (auth)');
    try {
        const res = await withTimeout(http(port, 'GET', '/v1/adapters', { token }), 5000, 'adapters');
        assert(res.status === 200, `expected 200, got ${res.status}`);
        assert(Array.isArray(res.json.adapters), 'expected adapters array');
        const ids = res.json.adapters.map((a) => a.id);
        for (const id of ['bedrock', 'openai', 'google', 'anthropic', 'ollama']) {
            assert(ids.includes(id), `missing adapter ${id}`);
        }
        pass('GET /v1/adapters', `${ids.length} adapters: ${ids.join(', ')}`);
    } catch (err) {
        fail('GET /v1/adapters', err);
    }
}

async function testOllamaModels(port, token) {
    header('GET /v1/adapters/ollama/models (live discovery)');
    try {
        const res = await withTimeout(http(port, 'GET', '/v1/adapters/ollama/models', { token }), 5000, 'ollama models');
        assert(res.status === 200, `expected 200, got ${res.status}`);
        assert(res.json.provider === 'ollama', 'expected provider=ollama');
        assert(Array.isArray(res.json.models), 'expected models array');
        if (res.json.models.length === 0) {
            skip('live discovery returned 0 models', 'ollama not running?');
            return;
        }
        pass('GET /v1/adapters/ollama/models', `${res.json.models.length} model(s): ${res.json.models.slice(0, 3).join(', ')}`);
    } catch (err) {
        fail('GET /v1/adapters/ollama/models', err);
    }
}

async function testOllamaVerify(port, token) {
    header('POST /v1/adapters/ollama/verify');
    try {
        const res = await withTimeout(http(port, 'POST', '/v1/adapters/ollama/verify', {
            token, body: { provider: 'ollama' },
        }), 10000, 'ollama verify');
        // 200 if OK, 503 if daemon is reachable but the call fails.
        if (res.status === 200) {
            pass('POST /v1/adapters/ollama/verify', res.json.detail);
        } else if (res.status === 503) {
            skip('POST /v1/adapters/ollama/verify', res.json.detail);
        } else {
            throw new Error(`unexpected status ${res.status}: ${res.text}`);
        }
    } catch (err) {
        fail('POST /v1/adapters/ollama/verify', err);
    }
}

async function testChatOllama(port, token) {
    header('POST /v1/chat (ollama, non-streaming)');
    try {
        const res = await withTimeout(http(port, 'POST', '/v1/chat', {
            token,
            body: {
                adapter: 'ollama',
                model: TINY_MODEL,
                messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
                config: { baseURL: OLLAMA_BASE },
            },
        }), 30000, 'chat ollama');
        assert(res.status === 200, `expected 200, got ${res.status}: ${res.text}`);
        assert(res.json.message, 'expected message in response');
        const text = (res.json.message.content || '').trim();
        assert(text.length > 0, 'empty content');
        assert(res.json.usage, 'expected usage in response');
        pass('POST /v1/chat', `model=${res.json.model} · "${text.slice(0, 40)}" · ${res.json.usage.totalTokens} tokens`);
    } catch (err) {
        fail('POST /v1/chat', err);
    }
}

async function testChatBedrock(port, token) {
    header('POST /v1/chat (bedrock, real)');
    const auth = loadAuth();
    if (!auth.aws?.accessKeyId || !auth.aws?.secretAccessKey) {
        skip('POST /v1/chat (bedrock)', 'no aws credentials in auth.json');
        return;
    }
    try {
        const res = await withTimeout(http(port, 'POST', '/v1/chat', {
            token,
            body: {
                adapter: 'bedrock',
                model: process.env.BEDROCK_TEST_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
                messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
                config: { maxTokens: 32 },
            },
        }), 60000, 'chat bedrock');
        if (res.status === 200) {
            const text = (res.json.message.content || '').trim();
            assert(text.length > 0, 'empty content');
            pass('POST /v1/chat (bedrock)', `model=${res.json.model} · "${text.slice(0, 40)}" · ${res.json.usage.totalTokens} tokens`);
        } else {
            const detail = res.json?.error || res.text;
            if (detail.includes('AccessDenied') || detail.includes('not enabled')) {
                skip('POST /v1/chat (bedrock)', 'credentials valid, model not enabled in this AWS account');
            } else {
                throw new Error(`status ${res.status}: ${detail}`);
            }
        }
    } catch (err) {
        fail('POST /v1/chat (bedrock)', err);
    }
}

async function testAuthRequired(port) {
    header('Auth enforcement');
    try {
        // No token — should 401
        const res = await withTimeout(http(port, 'GET', '/v1/adapters'), 5000, 'unauth');
        assert(res.status === 401, `expected 401 without token, got ${res.status}`);
        pass('GET /v1/adapters without token → 401');
    } catch (err) {
        fail('Auth enforcement', err);
    }
}

async function testInvalidAdapter(port, token) {
    header('Validation: unknown adapter');
    try {
        const res = await withTimeout(http(port, 'POST', '/v1/chat', {
            token,
            body: {
                adapter: 'gpt-9000',
                model: 'whatever',
                messages: [{ role: 'user', content: 'hi' }],
            },
        }), 5000, 'invalid adapter');
        assert(res.status === 400, `expected 400, got ${res.status}`);
        assert(res.json.error.includes('Unknown adapter'), `expected error message, got: ${res.json.error}`);
        pass('POST /v1/chat with unknown adapter → 400', res.json.error);
    } catch (err) {
        fail('Validation: unknown adapter', err);
    }
}

// ===== Runner =====

(async () => {
    console.log(`${ANSI.bold}${ANSI.cyan}memoryblock /v1 API verification${ANSI.reset}${ANSI.dim} — ${new Date().toISOString()}${ANSI.reset}`);

    let server, tempWs, port, token;
    try {
        const boot = await startApiServer();
        server = boot.server; port = boot.port; token = boot.token; tempWs = boot.tempWs;
        console.log(`${ANSI.dim}  Test server: http://127.0.0.1:${port} (token: ${token.slice(0, 12)}…)${ANSI.reset}`);

        await testHealth(port);
        await testAuthRequired(port);
        await testAdaptersList(port, token);
        await testOllamaModels(port, token);
        await testOllamaVerify(port, token);
        await testChatOllama(port, token);
        await testChatBedrock(port, token);
        await testInvalidAdapter(port, token);
    } catch (err) {
        fail('Server boot', err);
    } finally {
        if (server) await stopApiServer(server, tempWs);
    }

    // Summary
    const total = passCount + failCount + skipCount;
    console.log(`\n${ANSI.bold}━━━ Summary ━━━${ANSI.reset}`);
    console.log(`  ${ANSI.green}✓ ${passCount} passed${ANSI.reset}  ${ANSI.red}✗ ${failCount} failed${ANSI.reset}  ${ANSI.yellow}○ ${skipCount} skipped${ANSI.reset}  ${ANSI.dim}(${total} total)${ANSI.reset}`);

    if (failures.length) {
        console.log(`\n${ANSI.red}${ANSI.bold}Failures:${ANSI.reset}`);
        for (const f of failures) {
            console.log(`  ${ANSI.red}·${ANSI.reset} ${f.name}: ${f.err}`);
        }
    }

    process.exit(failCount > 0 ? 1 : 0);
})().catch((err) => {
    console.error(`\n${ANSI.red}${ANSI.bold}verify-v1 crashed:${ANSI.reset}`, err);
    process.exit(1);
});
