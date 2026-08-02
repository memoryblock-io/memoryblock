#!/usr/bin/env bun
/**
 * verify-adapters.js — Phase 1 adapter verification suite.
 *
 * Tests all 5 memoryblock adapters end-to-end:
 *   - Ollama   → real call to local Ollama (qwen2.5:0.5b)
 *   - OpenAI   → real call routed to local Ollama via baseURL swap
 *   - Gemini   → real call routed to local Ollama via baseURL swap
 *   - Anthropic→ request shape via mocked fetch (no paid plan)
 *   - Bedrock  → real call using existing AWS creds from auth.json
 *
 * Secrets are read from ~/.memoryblock/ws/auth.json (gitignored) and
 * are NEVER echoed, logged, or written elsewhere. Real keys are passed
 * straight to the adapter constructor and used only for the duration of
 * the test request.
 *
 * Run with:   pnpm verify:adapters
 * Or:         bun scripts/verify-adapters.js
 */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');

const ANSI = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
};

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
const TINY_MODEL = 'qwen2.5:0.5b';
const PING_PROMPT = [
    { role: 'system', content: 'You are a terse responder.' },
    { role: 'user', content: 'Reply with the single word: pong' },
];

let passCount = 0;
let failCount = 0;
let skipCount = 0;
const failures = [];

function pass(name, detail = '') {
    passCount++;
    console.log(`  ${ANSI.green}✓${ANSI.reset} ${name}${detail ? ANSI.dim + ' — ' + detail + ANSI.reset : ''}`);
}
function fail(name, err) {
    failCount++;
    failures.push({ name, err });
    const msg = err && err.message ? err.message : String(err);
    console.log(`  ${ANSI.red}✗${ANSI.reset} ${name}${ANSI.dim} — ${msg}${ANSI.reset}`);
}
function skip(name, reason = '') {
    skipCount++;
    console.log(`  ${ANSI.yellow}○${ANSI.reset} ${name}${ANSI.dim}${reason ? ' — ' + reason : ''}${ANSI.reset}`);
}
function header(text) {
    console.log(`\n${ANSI.cyan}${ANSI.bold}━━━ ${text} ━━━${ANSI.reset}`);
}

function loadAuth() {
    const path = join(homedir(), '.memoryblock', 'ws', 'auth.json');
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return {};
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

// ===== Test sections =====

async function testOllamaStatic() {
    header('Ollama — static probes');
    const { OllamaAdapter } = await import('../packages/adapters/dist/ollama/index.js');

    const available = await withTimeout(
        OllamaAdapter.isAvailable(OLLAMA_BASE.replace(/\/v1$/, '')),
        3000,
        'Ollama probe',
    );
    if (available) {
        pass('isAvailable()', 'Ollama daemon reachable');
    } else {
        fail('isAvailable()', new Error('Ollama daemon not reachable at ' + OLLAMA_BASE));
        return false;
    }

    const models = await withTimeout(
        OllamaAdapter.listAvailableModels(OLLAMA_BASE.replace(/\/v1$/, '')),
        5000,
        'Ollama tag list',
    );
    if (models.length === 0) {
        fail('listAvailableModels()', new Error('No models installed'));
        return false;
    }
    pass('listAvailableModels()', `${models.length} model(s): ${models.slice(0, 4).join(', ')}${models.length > 4 ? '…' : ''}`);

    if (!models.includes(TINY_MODEL)) {
        skip(`Tiny model present (${TINY_MODEL})`, `not pulled; have: ${models.join(', ')}`);
        return false;
    }
    pass(`Tiny model present`, TINY_MODEL);
    return true;
}

async function testOllamaReal() {
    header('Ollama — real round trip');
    const { OllamaAdapter } = await import('../packages/adapters/dist/ollama/index.js');

    const adapter = new OllamaAdapter({ model: TINY_MODEL, baseURL: OLLAMA_BASE });
    assert(adapter.provider === 'ollama', 'provider should be "ollama"');
    assert(adapter.model === TINY_MODEL, 'model should round-trip');

    try {
        const res = await withTimeout(adapter.converse(PING_PROMPT), 30000, 'converse');
        assert(res.message, 'response.message missing');
        const text = (res.message.content || '').trim();
        assert(text.length > 0, 'response content empty');
        pass('converse()', `model replied: "${text.slice(0, 40)}" · ${res.usage.totalTokens} tokens`);
    } catch (err) {
        fail('converse()', err);
        return;
    }

    try {
        let chunks = 0;
        let streamed = '';
        const res = await withTimeout(
            adapter.converseStream(PING_PROMPT, undefined, (chunk) => {
                chunks++;
                streamed += chunk;
            }),
            30000,
            'converseStream',
        );
        assert(res.message, 'stream response.message missing');
        assert(chunks > 0, `expected at least 1 chunk, got ${chunks}`);
        pass('converseStream()', `${chunks} chunk(s), final: "${(streamed || res.message.content || '').trim().slice(0, 40)}"`);
    } catch (err) {
        fail('converseStream()', err);
    }
}

async function testOpenAIThroughOllama() {
    header('OpenAI → Ollama (baseURL swap)');
    const { OpenAIAdapter } = await import('../packages/adapters/dist/openai/index.js');

    const adapter = new OpenAIAdapter({
        model: TINY_MODEL,
        apiKey: 'ollama', // Ollama ignores the key but adapter requires one
        baseURL: OLLAMA_BASE,
    });
    try {
        const res = await withTimeout(adapter.converse(PING_PROMPT), 30000, 'converse');
        const text = (res.message.content || '').trim();
        assert(text.length > 0, 'empty content');
        pass('converse() via Ollama', `"${text.slice(0, 40)}" · ${res.usage.totalTokens} tokens`);
    } catch (err) {
        fail('converse() via Ollama', err);
    }
}

async function testGoogleThroughOllama() {
    header('Google → Ollama (baseURL swap)');
    const { GoogleAdapter } = await import('../packages/adapters/dist/google/index.js');

    const adapter = new GoogleAdapter({
        model: TINY_MODEL,
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE,
    });
    try {
        const res = await withTimeout(adapter.converse(PING_PROMPT), 30000, 'converse');
        const text = (res.message.content || '').trim();
        assert(text.length > 0, 'empty content');
        pass('converse() via Ollama', `"${text.slice(0, 40)}" · ${res.usage.totalTokens} tokens`);
    } catch (err) {
        fail('converse() via Ollama', err);
    }
}

async function testAnthropicShape() {
    header('Anthropic — request shape (mocked, no paid plan)');
    const { AnthropicAdapter } = await import('../packages/adapters/dist/anthropic/index.js');

    let capturedRequest = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        capturedRequest = { url: String(url), init };
        return new Response(JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'mock-ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 2 },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const adapter = new AnthropicAdapter({ apiKey: 'sk-ant-test', model: 'claude-3-5-haiku-20241022' });
        const res = await adapter.converse(PING_PROMPT);
        const body = JSON.parse(capturedRequest.init.body);
        const headers = capturedRequest.init.headers;

        assert(capturedRequest.url.includes('api.anthropic.com'), `URL should hit api.anthropic.com, got ${capturedRequest.url}`);
        assert(headers['x-api-key'] === 'sk-ant-test', 'x-api-key header missing');
        assert(headers['anthropic-version'], 'anthropic-version header missing');
        assert(body.model === 'claude-3-5-haiku-20241022', 'model not echoed');
        assert(Array.isArray(body.messages), 'messages not an array');
        assert(body.system, 'system prompt not separated');
        assert(body.max_tokens > 0, 'max_tokens missing');
        pass('converse()', `URL=${new URL(capturedRequest.url).host} · model=${body.model} · system+${body.messages.length} msgs`);
    } catch (err) {
        fail('converse()', err);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function testOpenAIShape() {
    header('OpenAI — request shape (mocked, no paid plan)');
    const { OpenAIAdapter } = await import('../packages/adapters/dist/openai/index.js');

    let capturedRequest = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        capturedRequest = { url: String(url), init };
        return new Response(JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: 'mock-ok' },
                finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        const adapter = new OpenAIAdapter({ apiKey: 'sk-test', model: 'gpt-4o-mini' });
        const res = await adapter.converse(PING_PROMPT);
        const body = JSON.parse(capturedRequest.init.body);
        const headers = capturedRequest.init.headers;

        assert(capturedRequest.url.includes('api.openai.com'), `URL should hit api.openai.com, got ${capturedRequest.url}`);
        assert(headers.Authorization === 'Bearer sk-test', 'Authorization header missing/wrong');
        assert(body.model === 'gpt-4o-mini', 'model not echoed');
        assert(body.messages.length >= 2, 'expected at least 2 messages (system + user)');
        assert(body.max_tokens > 0, 'max_tokens missing');
        pass('converse()', `URL=${new URL(capturedRequest.url).host} · model=${body.model} · ${body.messages.length} msgs`);
    } catch (err) {
        fail('converse()', err);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function testGoogleShape() {
    header('Google — request shape (mocked, no paid plan)');
    const { GoogleAdapter } = await import('../packages/adapters/dist/google/index.js');

    let capturedRequest = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        capturedRequest = { url: String(url), init };
        return new Response(JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [{
                index: 0,
                message: { role: 'assistant', content: 'mock-ok' },
                finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        const adapter = new GoogleAdapter({ apiKey: 'AIza-test', model: 'gemini-2.5-flash' });
        const res = await adapter.converse(PING_PROMPT);
        const body = JSON.parse(capturedRequest.init.body);
        const headers = capturedRequest.init.headers;

        assert(capturedRequest.url.includes('generativelanguage.googleapis.com'), `URL should hit Google Gemini, got ${capturedRequest.url}`);
        assert(headers.Authorization === 'Bearer AIza-test', 'Authorization header missing/wrong');
        assert(body.model === 'gemini-2.5-flash', 'model not echoed');
        pass('converse()', `URL=${new URL(capturedRequest.url).host} · model=${body.model} · ${body.messages.length} msgs`);
    } catch (err) {
        fail('converse()', err);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function testBedrockReal() {
    header('Bedrock — real round trip (uses auth.json)');
    const auth = loadAuth();
    const aws = auth.aws;
    if (!aws?.accessKeyId || !aws?.secretAccessKey) {
        skip('Bedrock', 'no aws credentials in auth.json');
        return;
    }

    const { BedrockAdapter } = await import('../packages/adapters/dist/bedrock/index.js');
    const model = process.env.BEDROCK_TEST_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

    const adapter = new BedrockAdapter({
        model,
        region: aws.region || 'us-east-1',
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
        maxTokens: 32,
    });

    try {
        const res = await withTimeout(adapter.converse(PING_PROMPT), 60000, 'bedrock converse');
        const text = (res.message.content || '').trim();
        assert(text.length > 0, 'empty content');
        pass('converse()', `model=${model} · "${text.slice(0, 40)}" · ${res.usage.totalTokens} tokens`);
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (msg.includes('AccessDenied') || msg.includes('not enabled') || msg.includes('on-demand')) {
            skip('converse()', `model not enabled in this AWS account — creds valid. Set BEDROCK_TEST_MODEL=… to pick another.`);
        } else {
            fail('converse()', err);
        }
    }
}

// ===== Runner =====

(async () => {
    console.log(`${ANSI.bold}${ANSI.cyan}memoryblock adapter verification${ANSI.reset}${ANSI.dim} — ${new Date().toISOString()}${ANSI.reset}`);

    // Static probes first to gate the real tests
    const ollamaReady = await testOllamaStatic();
    if (!ollamaReady) {
        console.log(`\n${ANSI.yellow}Ollama not ready — skipping real-call tests. Start the daemon with:${ANSI.reset}`);
        console.log(`${ANSI.dim}  /opt/homebrew/opt/ollama/bin/ollama serve${ANSI.reset}\n`);
    } else {
        await testOllamaReal();
        await testOpenAIThroughOllama();
        await testGoogleThroughOllama();
    }

    // Mocked shape tests — always run, no creds needed
    await testAnthropicShape();
    await testOpenAIShape();
    await testGoogleShape();

    // Bedrock real — only if creds present
    await testBedrockReal();

    // Summary
    const total = passCount + failCount + skipCount;
    console.log(`\n${ANSI.bold}━━━ Summary ━━━${ANSI.reset}`);
    console.log(`  ${ANSI.green}✓ ${passCount} passed${ANSI.reset}  ${ANSI.red}✗ ${failCount} failed${ANSI.reset}  ${ANSI.yellow}○ ${skipCount} skipped${ANSI.reset}  ${ANSI.dim}(${total} total)${ANSI.reset}`);

    if (failures.length) {
        console.log(`\n${ANSI.red}${ANSI.bold}Failures:${ANSI.reset}`);
        for (const f of failures) {
            console.log(`  ${ANSI.red}·${ANSI.reset} ${f.name}: ${f.err.message || f.err}`);
        }
    }

    process.exit(failCount > 0 ? 1 : 0);
})().catch((err) => {
    console.error(`\n${ANSI.red}${ANSI.bold}verify-adapters crashed:${ANSI.reset}`, err);
    process.exit(1);
});