/**
 * OllamaInstaller — process-level helpers for installing, starting, and
 * pulling models from the Ollama daemon.
 *
 * This module spawns child processes (brew, curl, ollama). The pure HTTP
 * adapter lives in `@memoryblock/adapters/ollama`. This module is CLI-only
 * and intentionally has no dependency on `clack` or other UI concerns so it
 * can be unit-tested and reused.
 *
 * All `exec` calls stream stdout/stderr to the provided listener (if any)
 * so the init wizard can surface progress in its spinner.
 */
import { spawn, exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execAsync = promisify(exec);

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min for slow networks
const PULL_TIMEOUT_MS = 30 * 60 * 1000;    // 30 min for large models
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;            // 15s for daemon to bind to port

export type ProgressLine = { stream: 'stdout' | 'stderr'; text: string };

export interface InstallOptions {
    /** Stream every output line. Called once per line. */
    onProgress?: (line: ProgressLine) => void;
    /** Hard timeout in ms. Default 10 minutes. */
    timeoutMs?: number;
}

export interface PullOptions extends InstallOptions {
    timeoutMs?: number;
}

export interface DaemonOptions {
    /** Where to write the daemon's log. Default `~/.memoryblock/logs/ollama.log`. */
    logPath?: string;
    /** Stream daemon stderr/stdout. */
    onProgress?: (line: ProgressLine) => void;
    /** Abort if daemon does not respond within this many ms. Default 15s. */
    waitMs?: number;
}

/** Detect whether the ollama binary is on PATH or in a known install location. */
export async function isInstalled(): Promise<boolean> {
    const bin = await findBinary();
    return bin !== null;
}

/** Resolve the ollama binary, or null if not installed. */
export async function findBinary(): Promise<string | null> {
    // Check PATH first
    try {
        const { stdout } = await execAsync('command -v ollama', { timeout: 3000 });
        const resolved = stdout.trim().split('\n')[0];
        if (resolved && existsSync(resolved)) return resolved;
    } catch {
        // fall through to platform-specific guesses
    }

    // Common install locations
    const guesses: string[] = [];
    if (platform() === 'darwin') {
        guesses.push('/opt/homebrew/bin/ollama', '/usr/local/bin/ollama');
    } else if (platform() === 'linux') {
        guesses.push('/usr/local/bin/ollama', '/usr/bin/ollama', join(homedir(), '.local', 'bin', 'ollama'));
    } else if (platform() === 'win32') {
        guesses.push(join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'));
    }
    for (const g of guesses) {
        if (existsSync(g)) return g;
    }
    return null;
}

/** Return installed ollama version, or null if not installed. */
export async function getVersion(): Promise<string | null> {
    const bin = await findBinary();
    if (!bin) return null;
    try {
        const { stdout } = await execAsync(`"${bin}" --version`, { timeout: 5000 });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/** Probe whether the daemon is reachable. */
export async function isRunning(host: string = DEFAULT_HOST): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Install Ollama using the platform-appropriate method.
 * - macOS (Apple Silicon / Intel): `brew install ollama` if brew is available,
 *   else fall back to the official `curl | sh` script.
 * - Linux: official `curl | sh` script.
 * - Windows: throws with manual install instructions (no auto-install).
 *
 * Streams stdout/stderr line-by-line via `onProgress`. Resolves when the
 * command exits with code 0; rejects on non-zero exit or timeout.
 */
export async function install(opts: InstallOptions = {}): Promise<void> {
    const onProgress = opts.onProgress || (() => {});
    const timeoutMs = opts.timeoutMs || INSTALL_TIMEOUT_MS;

    const os = platform();
    if (os === 'win32') {
        throw new Error(
            'Automatic Ollama install is not supported on Windows. ' +
            'Download the installer from https://ollama.com/download and re-run `mblk init`.'
        );
    }

    let cmd: string;
    let args: string[] = [];
    if (os === 'darwin') {
        const brewPath = await findExecutable('brew');
        if (brewPath) {
            cmd = brewPath;
            args = ['install', 'ollama'];
        } else {
            cmd = 'curl';
            args = ['-fsSL', 'https://ollama.com/install.sh'];
        }
    } else {
        // Linux
        const curlPath = await findExecutable('curl');
        if (!curlPath) {
            throw new Error('curl is required to install Ollama on Linux. Install curl and retry.');
        }
        cmd = curlPath;
        args = ['-fsSL', 'https://ollama.com/install.sh'];
    }

    await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let pipedToSh = false;

        // If we used curl to fetch the install script, pipe to sh
        if (args[0] === '-fsSL' && cmd.endsWith('curl')) {
            const sh = spawn('sh', [], { stdio: ['pipe', 'pipe', 'pipe'] });
            child.stdout.pipe(sh.stdin);
            pipedToSh = true;
            attachLineSplitter(sh.stdout, (text) => onProgress({ stream: 'stdout', text }));
            attachLineSplitter(sh.stderr, (text) => onProgress({ stream: 'stderr', text }));
            sh.on('exit', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Ollama install script exited with code ${code}`));
            });
            sh.on('error', reject);
        }

        attachLineSplitter(child.stdout, (text) => onProgress({ stream: 'stdout', text }));
        attachLineSplitter(child.stderr, (text) => onProgress({ stream: 'stderr', text }));

        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Ollama install timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);

        child.on('exit', (code) => {
            clearTimeout(timer);
            if (pipedToSh) return; // resolution handled by the sh child
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Ensure the Ollama daemon is running. If installed but not running,
 * spawns `ollama serve` as a detached background process and waits for
 * it to bind to its port.
 */
export async function ensureRunning(opts: DaemonOptions = {}): Promise<{ started: boolean; logPath: string }> {
    if (await isRunning()) {
        return { started: false, logPath: opts.logPath || defaultLogPath() };
    }
    const bin = await findBinary();
    if (!bin) {
        throw new Error('Ollama binary not found. Call `install()` first.');
    }

    const logPath = opts.logPath || defaultLogPath();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(logPath, '..'), { recursive: true });

    const out = (await import('node:fs')).openSync(logPath, 'a');
    const child = spawn(bin, ['serve'], {
        detached: true,
        stdio: ['ignore', out, out],
        env: process.env,
    });
    child.unref();
    (await import('node:fs')).closeSync(out);

    // Wait for it to bind
    const deadline = Date.now() + (opts.waitMs || POLL_TIMEOUT_MS);
    while (Date.now() < deadline) {
        if (await isRunning()) {
            opts.onProgress?.({ stream: 'stdout', text: 'Ollama daemon ready.' });
            return { started: true, logPath };
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Ollama daemon did not start within ${Math.round((opts.waitMs || POLL_TIMEOUT_MS) / 1000)}s. Check ${logPath}.`);
}

/** Pull a model by tag (e.g. `qwen2.5:0.5b`). Streams progress. */
export async function pullModel(model: string, opts: PullOptions = {}): Promise<void> {
    const bin = await findBinary();
    if (!bin) {
        throw new Error('Ollama binary not found. Call `install()` first.');
    }
    const timeoutMs = opts.timeoutMs || PULL_TIMEOUT_MS;
    const onProgress = opts.onProgress || (() => {});

    await new Promise<void>((resolve, reject) => {
        const child = spawn(bin, ['pull', model], { stdio: ['ignore', 'pipe', 'pipe'] });
        attachLineSplitter(child.stdout, (text) => onProgress({ stream: 'stdout', text }));
        attachLineSplitter(child.stderr, (text) => onProgress({ stream: 'stderr', text }));
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`Ollama pull of ${model} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        child.on('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ollama pull exited with code ${code}`));
        });
        child.on('error', reject);
    });
}

/** List models currently installed in the local Ollama daemon. */
export async function listModels(): Promise<string[]> {
    const bin = await findBinary();
    if (!bin) return [];
    try {
        const { stdout } = await execAsync(`"${bin}" list`, { timeout: 10000 });
        // Output format:
        // NAME                ID            SIZE      MODIFIED
        // qwen2.5:0.5b        ...           397 MB    2 days ago
        return stdout
            .split('\n')
            .slice(1) // header
            .map((line) => line.trim().split(/\s+/)[0])
            .filter((name) => name && name !== 'NAME');
    } catch {
        return [];
    }
}

// ===== helpers =====

function defaultLogPath(): string {
    return join(homedir(), '.memoryblock', 'logs', 'ollama.log');
}

async function findExecutable(name: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync(`command -v ${name}`, { timeout: 3000 });
        const path = stdout.trim().split('\n')[0];
        if (path && existsSync(path)) return path;
    } catch {
        // ignore
    }
    return null;
}

function attachLineSplitter(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).replace(/\r$/, '');
            buffer = buffer.slice(idx + 1);
            if (line.length > 0) onLine(line);
        }
    });
    stream.on('end', () => {
        if (buffer.length > 0) onLine(buffer);
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}