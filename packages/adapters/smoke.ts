/**
 * Smoke-check that the single factory (`createMemoryAdapter`) reaches
 * each provider's upstream with the expected wire. No real credentials.
 */
import { createMemoryAdapter } from './dist/index.js';

async function check(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
        await fn();
        console.log(`[${label}] unexpected success`);
    } catch (err) {
        const e = err as { code?: string; status?: number; message?: string };
        console.log(`[${label}]`, e.code ?? '', e.status ?? '', e.message ?? '');
    }
}

async function main(): Promise<void> {
    await check('OpenAI → minimax', () =>
        createMemoryAdapter({
            provider: 'openai',
            model: 'MiniMax-M3',
            apiKey: 'sk-probe',
            baseURL: 'https://api.minimax.io/v1',
        }).converse([{ role: 'user', content: 'hi' }]),
    );

    await check('Anthropic', () =>
        createMemoryAdapter({
            provider: 'anthropic',
            model: 'claude-3-5-haiku-20241022',
            apiKey: 'sk-ant-probe',
        }).converse([{ role: 'user', content: 'hi' }]),
    );

    await check('Google', () =>
        createMemoryAdapter({
            provider: 'google',
            model: 'gemini-2.5-flash',
            apiKey: 'AIza-probe',
        }).converse([{ role: 'user', content: 'hi' }]),
    );

    await check('Ollama (no daemon)', () =>
        createMemoryAdapter({ provider: 'ollama', model: 'llama3.2' })
            .converse([{ role: 'user', content: 'hi' }]),
    );
}

main().catch((err) => {
    console.error('smoke crashed:', err);
    process.exit(1);
});
