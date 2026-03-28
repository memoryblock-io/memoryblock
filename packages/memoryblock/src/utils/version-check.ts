/**
 * Version check — compares local version against npm registry.
 * Used by CLI (startup hint) and API server (web UI badge).
 *
 * Caches results for 6 hours to avoid spamming npm on every command.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const NPM_REGISTRY = 'https://registry.npmjs.org/memoryblock/latest';

interface VersionCache {
    latest: string;
    checkedAt: number;
}

function cachePath(): string {
    return join(homedir(), '.memoryblock', '.version-cache.json');
}

async function readCache(): Promise<VersionCache | null> {
    try {
        const raw = await fsp.readFile(cachePath(), 'utf-8');
        const data = JSON.parse(raw) as VersionCache;
        if (Date.now() - data.checkedAt < CACHE_TTL) return data;
    } catch { /* no cache or expired */ }
    return null;
}

async function writeCache(latest: string): Promise<void> {
    try {
        const dir = join(homedir(), '.memoryblock');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(cachePath(), JSON.stringify({ latest, checkedAt: Date.now() }));
    } catch { /* ignore */ }
}

/**
 * Check if a newer version of memoryblock is available on npm.
 * Returns { current, latest, updateAvailable } or null on error.
 */
export async function checkForUpdate(currentVersion: string): Promise<{
    current: string;
    latest: string;
    updateAvailable: boolean;
} | null> {
    try {
        // Check cache first
        const cached = await readCache();
        if (cached) {
            return {
                current: currentVersion,
                latest: cached.latest,
                updateAvailable: isNewer(cached.latest, currentVersion),
            };
        }

        // Fetch from npm (with timeout)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(NPM_REGISTRY, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });
        clearTimeout(timeout);

        if (!res.ok) return null;

        const data = await res.json() as { version: string };
        const latest = data.version;

        await writeCache(latest);

        return {
            current: currentVersion,
            latest,
            updateAvailable: isNewer(latest, currentVersion),
        };
    } catch {
        return null; // Network error, offline, etc. — never block the CLI
    }
}

/**
 * Simple semver comparison: is `a` newer than `b`?
 */
function isNewer(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return true;
        if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
}
