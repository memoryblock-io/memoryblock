import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson, readJsonSafe, writeJson, pathExists } from './fs.js';
import {
    GlobalConfigSchema, BlockConfigSchema, AuthConfigSchema, PulseStateSchema,
} from '@memoryblock/types';
import type {
    GlobalConfig, BlockConfig, AuthConfig, ProviderAuth, PulseState,
} from '@memoryblock/types';

// ===== Paths =====
const MEMORYBLOCK_HOME = join(homedir(), '.memoryblock');
const WS_ROOT = join(MEMORYBLOCK_HOME, 'ws');
const CONFIG_PATH = join(WS_ROOT, 'config.json');
const AUTH_PATH = join(WS_ROOT, 'auth.json');

export function getHome(): string { return MEMORYBLOCK_HOME; }
export function getWsRoot(): string { return WS_ROOT; }
export function getConfigPath(): string { return CONFIG_PATH; }
export function getAuthPath(): string { return AUTH_PATH; }

/** Check if memoryblock has been initialized. */
export async function isInitialized(): Promise<boolean> {
    return pathExists(CONFIG_PATH);
}

import { setLocale } from '@memoryblock/locale';

/** 
 * Wraps Zod schema parsing to provide human-readable errors.
 */
function parseConfig<T>(schema: { parse: (data: unknown) => T }, data: unknown, filePath: string): T {
    try {
        return schema.parse(data) as T;
    } catch (err: unknown) {
        if (err && typeof err === 'object' && 'issues' in err) {
            const issues = (err as any).issues.map((i: any) => `  - [${i.path.join('.') || 'root'}]: ${i.message}`).join('\n');
            throw new Error(`Configuration error in ${filePath}:\n${issues}\n\nPlease fix the file to continue.`);
        }
        throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
    }
}

// ===== Global Config =====
/** 
 * Load global config from ~/.memoryblock/ws/config.json
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
    const raw = await readJsonSafe(CONFIG_PATH, {});
    const config = parseConfig(GlobalConfigSchema, raw, CONFIG_PATH);
    
    // Auto-apply language preference globally
    if (config.language) {
        setLocale(config.language);
    }
    
    return config;
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
    await writeJson(CONFIG_PATH, config);
}

// ===== Auth =====
/**
 * Map from generic `auth.providers[slug]` entries to the legacy
 * top-level fields that downstream code reads (e.g. `auth.openai.apiKey`).
 * Bedrock-family slugs all flatten to `auth.aws` so the existing
 * `auth.aws.accessKeyId` path keeps working.
 *
 * For any provider not in the map, the flatten target defaults to
 * `openai` — this is intentional: most new providers are OpenAI-compatible,
 * so the legacy resolver (`auth.openai?.apiKey || process.env.OPENAI_API_KEY`)
 * picks up the key correctly. Non-OpenAI providers that get added later
 * (e.g. a future Anthropic-only API) can extend this map.
 */
const LEGACY_SLOT: Record<string, string> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    gemini: 'gemini',
    ollama: 'ollama',
    bedrock: 'aws',
    'bedrock-aws': 'aws',
    'bedrock-converse': 'aws',
};

function flattenProviderAuth(auth: AuthConfig): AuthConfig {
    if (!auth.providers) return auth;
    const out: AuthConfig = { ...auth, providers: { ...auth.providers } };
    for (const [slug, creds] of Object.entries(auth.providers)) {
        // AWS-shaped credentials always go to `auth.aws`. Anything else
        // (just apiKey) goes to its legacy slot if one exists, else to
        // `auth.openai` — the OpenAI-compatible default that most new
        // providers speak.
        const hasAwsShape = (c: ProviderAuth | undefined) => Boolean(c?.accessKeyId || c?.secretAccessKey);
        const target = LEGACY_SLOT[slug] ?? (hasAwsShape(creds) ? 'aws' : 'openai');
        if (target === 'aws') {
            if (!out.aws && (creds.accessKeyId || creds.secretAccessKey || creds.region)) {
                out.aws = {
                    accessKeyId: String(creds.accessKeyId ?? ''),
                    secretAccessKey: String(creds.secretAccessKey ?? ''),
                    region: String(creds.region ?? 'us-east-1'),
                };
            }
        } else {
            // Generic apiKey-bearing slot.
            const existing = (out as unknown as Record<string, { apiKey?: string } | undefined>)[target];
            if (!existing?.apiKey && creds.apiKey) {
                (out as unknown as Record<string, { apiKey: string }>)[target] = { apiKey: String(creds.apiKey) };
            }
        }
    }
    return out;
}

/**
 * Load auth credentials from ~/.memoryblock/ws/auth.json
 *
 * Accepts both the new generic `auth.providers[slug]` shape and the legacy
 * top-level per-provider fields. Returns a flattened AuthConfig that
 * exposes both, so downstream code reading `auth.openai.apiKey` continues
 * to work even when the user only stored `auth.providers.openai.apiKey`.
 */
export async function loadAuth(): Promise<AuthConfig> {
    const raw = await readJsonSafe(AUTH_PATH, {});
    const parsed = parseConfig(AuthConfigSchema, raw, AUTH_PATH);
    return flattenProviderAuth(parsed);
}

export async function saveAuth(auth: AuthConfig): Promise<void> {
    await writeJson(AUTH_PATH, auth);
}

// ===== Block Config =====
export async function loadBlockConfig(blockPath: string): Promise<BlockConfig> {
    const filePath = join(blockPath, 'config.json');
    const raw = await readJson(filePath);
    return parseConfig(BlockConfigSchema, raw, filePath);
}

export async function saveBlockConfig(blockPath: string, config: BlockConfig): Promise<void> {
    await writeJson(join(blockPath, 'config.json'), config);
}

// ===== Pulse State =====
export async function loadPulseState(blockPath: string): Promise<PulseState> {
    const filePath = join(blockPath, 'pulse.json');
    const raw = await readJsonSafe(filePath, {});
    return parseConfig(PulseStateSchema, raw, filePath);
}

export async function savePulseState(blockPath: string, state: PulseState): Promise<void> {
    await writeJson(join(blockPath, 'pulse.json'), state);
}

// ===== Path Resolution =====
export function resolveBlocksDir(globalConfig: GlobalConfig): string {
    return resolve(WS_ROOT, globalConfig.blocksDir);
}

export function resolveBlockPath(globalConfig: GlobalConfig, blockName: string): string {
    return join(resolveBlocksDir(globalConfig), blockName);
}