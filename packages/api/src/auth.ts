import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const TOKEN_FILE = '.api-token';

/**
 * Generate a new API auth token.
 * Token format: mblk_<uuid> — short, readable, prefixed for easy identification.
 * 
 * The token is persisted to the workspace so the same browser session
 * survives server restarts. Only regenerated explicitly via `mblk web --new-token`.
 */
export async function generateAuthToken(workspacePath: string, forceNew = false): Promise<string> {
    const tokenPath = join(workspacePath, TOKEN_FILE);

    // Reuse existing token unless forced to regenerate
    if (!forceNew) {
        try {
            const existing = await readFile(tokenPath, 'utf-8');
            const token = existing.trim();
            if (token.startsWith('mblk_')) return token;
        } catch {
            // File doesn't exist — generate new
        }
    }

    const token = `mblk_${randomUUID().replace(/-/g, '')}`;
    
    try {
        await mkdir(workspacePath, { recursive: true });
        await writeFile(tokenPath, token, 'utf-8');
    } catch {
        // Non-critical — token works in-memory even if persistence fails
    }

    return token;
}

/**
 * Validate an auth token against the stored/active token.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateAuthToken(provided: string, expected: string): boolean {
    if (provided.length !== expected.length) return false;

    let result = 0;
    for (let i = 0; i < provided.length; i++) {
        result |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return result === 0;
}
