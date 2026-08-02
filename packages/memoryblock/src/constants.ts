/**
 * Shared constants for the CLI commands.
 * Single source of truth — imported by init.ts, start.ts, and mblk.ts.
 *
 * The provider list and per-provider auth schema are sourced from aiplug's
 * introspection API at module load. A static fallback ships in case
 * aiplug isn't installed (e.g. during monorepo bootstrapping before deps
 * resolve). The fallback is intentionally minimal — extend by adding the
 * provider to aiplug's registry, not to this list.
 */

import { AIPlug, type ProviderDescriptor, type ConfigField } from 'aiplug';

interface ProviderOption {
    value: string;
    label: string;
    hint: string;
}

interface ProviderAuthSchema {
    fields: Array<{ key: string; label: string; secret: boolean }>;
}

// Default port for the web/API server
export const DEFAULT_PORT = '8420';

/* ---------------------------------------------------------------------------
 * Provider list — aiplug-driven, with a small fallback if aiplug isn't
 * available at module load (e.g. dev mode before `pnpm install` finishes).
 * --------------------------------------------------------------------------- */

let _cachedProviders: ProviderOption[] | null = null;
let _cachedProviderAuth: Record<string, ProviderAuthSchema> | null = null;

// Static fallback used when aiplug isn't loadable. Keep this in sync with
// what aiplug's `aiplug.providers()` would return for the five "known"
// providers — these are the only ones with hardcoded hints here.
const STATIC_PROVIDER_AUTH: Record<string, ProviderAuthSchema> = {
    bedrock: {
        fields: [
            { key: 'accessKeyId', label: 'Access Key ID', secret: true },
            { key: 'secretAccessKey', label: 'Secret Access Key', secret: true },
            { key: 'region', label: 'Region', secret: false },
        ],
    },
    openai:    { fields: [{ key: 'apiKey', label: 'API Key', secret: true }] },
    anthropic: { fields: [{ key: 'apiKey', label: 'API Key', secret: true }] },
    google:    { fields: [{ key: 'apiKey', label: 'API Key', secret: true }] },
    gemini:    { fields: [{ key: 'apiKey', label: 'API Key', secret: true }] },
    ollama:    { fields: [] },
};

/**
 * Curated shortlist of "important" providers, surfaced in the TUI
 * wizard so the prompt stays scannable. The web UI shows the full
 * 100+ list; the TUI only shows these. Users can always type
 * `_custom` to enter any aiplug-registered slug.
 *
 * Order matters — this is the order they appear in the TUI default
 * selection. Update when a provider's market position changes.
 */
const IMPORTANT_PROVIDERS: ReadonlyArray<string> = [
    'openai',
    'anthropic',
    'google',
    'bedrock-aws',
    'minimax',
    'ollama',
    'deepseek',
    'zhipu',
    'moonshot',
    'xai',
];

// Sync access to aiplug via the top-level ES import. The `AIPlug` static
// surface (providers / configSchema) is synchronous; the lazy lookup is
// what the function is for (cheap, cached after first call).

function loadProviders(): ProviderOption[] {
    if (_cachedProviders) return _cachedProviders;
    let list: ProviderDescriptor[] = [];
    try {
        list = AIPlug.providers();
    } catch {
        // aiplug not installed at this path — fall back to a static list so
        // the CLI is still navigable in a bootstrapping dev environment.
        _cachedProviders = [
            { value: 'bedrock',   label: 'AWS Bedrock',  hint: 'Claude, Llama via AWS' },
            { value: 'openai',    label: 'OpenAI',       hint: 'GPT-4, GPT-4o' },
            { value: 'anthropic', label: 'Anthropic',     hint: 'Claude API direct' },
            { value: 'google',    label: 'Google Gemini', hint: 'Gemini Pro, Flash' },
            { value: 'ollama',    label: 'Ollama (local)', hint: 'Run models locally — no API key' },
        ];
        return _cachedProviders;
    }
    _cachedProviders = list
        .filter((p) => !p.isAlias)
        .map((p) => ({
            value: p.slug,
            label: p.displayName,
            hint: p.notes ?? p.category,
        }));
    return _cachedProviders;
}

function loadProviderAuth(): Record<string, ProviderAuthSchema> {
    if (_cachedProviderAuth) return _cachedProviderAuth;
    const out: Record<string, ProviderAuthSchema> = {};
    for (const p of loadProviders()) {
        try {
            out[p.value] = { fields: mapFields(AIPlug.configSchema(p.value).fields) };
        } catch {
            // Unknown provider slug — skip; the consumer falls back to
            // the static shape below.
        }
    }
    if (Object.keys(out).length === 0) {
        // aiplug unreachable — fall back to a hardcoded schema.
        return STATIC_PROVIDER_AUTH;
    }
    _cachedProviderAuth = out;
    return out;
}

function mapFields(fields: ConfigField[]): Array<{ key: string; label: string; secret: boolean }> {
    return fields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: Boolean(f.secret),
    }));
}

// Public read-only snapshots. Consumers (init.ts, web setup.js) read these
// at runtime — the values are cached after first call so repeated lookups
// are O(1).
export function getProviders(): readonly ProviderOption[] {
    return loadProviders();
}

export function getProviderAuth(): Record<string, ProviderAuthSchema> {
    return loadProviderAuth();
}

/**
 * Curated shortlist for TUI surfaces. The full list is too long for a
 * terminal picker, so the TUI shows this 10-entry list and lets the
 * user type any other aiplug slug via the `more` option. The web UI
 * shows the full list and doesn't use this function.
 *
 * Each entry is in the same `ProviderOption` shape as `getProviders()`
 * output, with the label + hint taken from aiplug when available and
 * a static fallback otherwise.
 */
export function getImportantProviders(): readonly ProviderOption[] {
    const all = loadProviders();
    const byId = new Map<string, ProviderOption>(all.map((p) => [p.value, p]));
    const out: ProviderOption[] = [];
    for (const slug of IMPORTANT_PROVIDERS) {
        const found = byId.get(slug);
        if (found) {
            out.push(found);
        } else {
            // aiplug doesn't know about this slug (very rare; would only
            // happen if aiplug's registry was pruned). Fall back to a
            // minimal stub so the TUI still offers the option.
            out.push({ value: slug, label: slug, hint: '' });
        }
    }
    return out;
}

// Back-compat: the static shape `PROVIDERS` / `PROVIDER_AUTH` was a const
// array / const record. We keep the names but back them with lazy getters
// so module-load errors in aiplug don't crash the rest of the CLI.
export const PROVIDERS: ProviderOption[] = loadProviders();
export const PROVIDER_AUTH: Record<string, ProviderAuthSchema> = loadProviderAuth();
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
 *
 * At runtime this file is at: packages/core/dist/cli/constants.js
 * package.json is at:         packages/core/package.json
 */
export async function getVersion(): Promise<string> {
    try {
        const { readFile } = await import('node:fs/promises');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');

        const thisDir = dirname(fileURLToPath(import.meta.url));
        // From dist/ → go up to memoryblock/
        const pkgPath = join(thisDir, '..', 'package.json');
        const raw = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw);
        return pkg.version || 'dev';
    } catch {
        return 'dev';
    }
}