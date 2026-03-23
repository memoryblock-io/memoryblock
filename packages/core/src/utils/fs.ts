import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Write content atomically: write to temp file, then rename.
 * Prevents corruption if the process crashes mid-write.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
    try {
        await fsp.writeFile(tmpPath, content, 'utf-8');
        await fsp.rename(tmpPath, filePath);
    } catch (err) {
        try { await fsp.unlink(tmpPath); } catch { /* ignore cleanup failure */ }
        throw err;
    }
}

/** Atomically write JSON with pretty formatting. */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
    await atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Read and parse JSON. Throws on missing file or invalid JSON. */
export async function readJson<T>(filePath: string): Promise<T> {
    const content = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
}

/** Read and parse JSON, returning fallback on any error. */
export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
    try {
        return await readJson<T>(filePath);
    } catch {
        return fallback;
    }
}

/** Read text file, returning fallback on any error. */
export async function readTextSafe(filePath: string, fallback: string = ''): Promise<string> {
    try {
        return await fsp.readFile(filePath, 'utf-8');
    } catch {
        return fallback;
    }
}

/** Ensure directory exists (recursive). */
export async function ensureDir(dirPath: string): Promise<void> {
    await fsp.mkdir(dirPath, { recursive: true });
}

/** Check if a path exists. */
export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fsp.access(targetPath);
        return true;
    } catch {
        return false;
    }
}
