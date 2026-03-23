import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJson, readJsonSafe, writeJson, pathExists } from './fs.js';
import {
    GlobalConfigSchema, BlockConfigSchema, AuthConfigSchema, PulseStateSchema,
} from '../schemas.js';
import type {
    GlobalConfig, BlockConfig, AuthConfig, PulseState,
} from '../types.js';

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
function parseConfig<T>(schema: { parse: (data: any) => T }, data: any, filePath: string): T {
    try {
        return schema.parse(data) as T;
    } catch (err: any) {
        if (err && err.issues) {
            const issues = err.issues.map((i: any) => `  - [${i.path.join('.') || 'root'}]: ${i.message}`).join('\n');
            throw new Error(`Configuration error in ${filePath}:\n${issues}\n\nPlease fix the file to continue.`);
        }
        throw new Error(`Failed to parse ${filePath}: ${err.message}`);
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
 * Load auth credentials from ~/.memoryblock/ws/auth.json
 */
export async function loadAuth(): Promise<AuthConfig> {
    const raw = await readJsonSafe(AUTH_PATH, {});
    return parseConfig(AuthConfigSchema, raw, AUTH_PATH);
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
