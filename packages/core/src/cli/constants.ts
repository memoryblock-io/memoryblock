/**
 * Shared constants for the CLI commands.
 * Single source of truth — imported by init.ts, start.ts, and mblk.ts.
 */

// Default port for the web/API server
export const DEFAULT_PORT = '8420';

// Available LLM providers
export const PROVIDERS = [
    { value: 'bedrock',   label: 'AWS Bedrock',        hint: 'Claude, Llama via AWS' },
    { value: 'anthropic', label: 'Anthropic',           hint: 'Claude API direct' },
    { value: 'openai',    label: 'OpenAI',              hint: 'GPT-4, GPT-4o' },
    { value: 'gemini',    label: 'Google Gemini',        hint: 'Gemini Pro, Flash' },
    { value: 'ollama',    label: 'Ollama (local)',       hint: 'Run models locally — no API key' },
] as Array<{ value: string; label: string; hint: string }>;

// Available communication channels
export const CHANNELS = [
    { value: 'cli',      label: 'Terminal (CLI)',   hint: 'always enabled' },
    { value: 'web',      label: 'Web Dashboard',    hint: 'always enabled' },
    { value: 'telegram', label: 'Telegram',         hint: 'bot token required' },
    { value: 'discord',  label: 'Discord',          hint: 'coming soon' },
    { value: 'slack',    label: 'Slack',             hint: 'coming soon' },
] as Array<{ value: string; label: string; hint: string }>;

// Optional skills & plugins
export const PLUGINS = [
    { value: 'web-search',    label: 'Web Search',      hint: 'search the web via Brave API' },
    { value: 'fetch-webpage', label: 'Fetch Webpage',    hint: 'extract text from URLs' },
    { value: 'aws',           label: 'AWS Tools',        hint: 'S3, Lambda, etc.' },
] as Array<{ value: string; label: string; hint: string }>;

// Auth fields needed per provider
export const PROVIDER_AUTH: Record<string, {
    fields: Array<{ key: string; label: string; secret: boolean }>;
}> = {
    bedrock: {
        fields: [
            { key: 'accessKeyId', label: 'Access Key ID', secret: true },
            { key: 'secretAccessKey', label: 'Secret Access Key', secret: true },
            { key: 'region', label: 'Region', secret: false },
        ],
    },
    anthropic: {
        fields: [{ key: 'apiKey', label: 'API Key', secret: true }],
    },
    openai: {
        fields: [{ key: 'apiKey', label: 'API Key', secret: true }],
    },
    gemini: {
        fields: [{ key: 'apiKey', label: 'API Key', secret: true }],
    },
    ollama: {
        fields: [], // No auth needed
    },
};

// Auth fields for channels
export const CHANNEL_AUTH: Record<string, Array<{ key: string; label: string; secret: boolean }>> = {
    telegram: [
        { key: 'botToken', label: 'Bot Token (from @BotFather)', secret: true },
        { key: 'chatId', label: 'Chat ID', secret: false },
    ],
};

/**
 * Read the package version from core's package.json at runtime.
 * Falls back to 'dev' if the file can't be read.
 */
export async function getVersion(): Promise<string> {
    try {
        const { readFile } = await import('node:fs/promises');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        // Navigate from this file to the core package.json
        // This file is at: packages/core/src/cli/constants.ts
        // package.json is at: packages/core/package.json
        const thisDir = dirname(fileURLToPath(import.meta.url));
        const pkgPath = join(thisDir, '..', '..', '..', 'package.json');
        const raw = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        return pkg.version || 'dev';
    } catch {
        return 'dev';
    }
}
