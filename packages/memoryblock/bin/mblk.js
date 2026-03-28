#!/usr/bin/env node

/**
 * memoryblock CLI — Universal Entry Point
 *
 * Runtime Strategy:
 *   1. If already running under Bun → fast path (direct import)
 *   2. If running under Node.js → try to find Bun and re-exec for performance
 *   3. If Bun is unavailable → run directly under Node.js (full fallback)
 *
 * Bun is RECOMMENDED for performance but NOT REQUIRED.
 * All core functionality works on Node.js ≥20.
 *
 * We NEVER auto-install Bun. We only suggest it once, politely.
 */

// Silence ALL Node.js native warnings (DeprecationWarning, ExperimentalWarning, etc.)
// These are irrelevant to end-users and completely break the TUI/console animations.
process.removeAllListeners('warning');

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const entryPath = join(__dirname, '..', 'dist', 'entry.js');

// ─── Runtime Detection ───────────────────────────────────────────────
const isBun = typeof globalThis.Bun !== 'undefined';
const isWindows = platform() === 'win32';
const isMblkDaemon = process.env.MBLK_IS_DAEMON === '1';
const isBunProxy = process.env.MEMORYBLOCK_BUN_PROXY === '1';
const noBun = process.env.MEMORYBLOCK_NO_BUN === '1';

// ─── Fast Path: Already running under Bun ────────────────────────────
if (isBun) {
    try {
        await import(entryPath);
    } catch (err) {
        console.error('❌ Failed to load memoryblock CLI.');
        console.error('   Try reinstalling: npm install -g memoryblock');
        if (err && typeof err === 'object' && 'message' in err) {
            console.error(`\n   Error: ${err.message}`);
        }
        process.exit(1);
    }
} else {
    // ─── Node.js Path: Try Bun for performance, fallback to Node ─────
    const localBun = isWindows
        ? join(homedir(), '.bun', 'bin', 'bun.exe')
        : join(homedir(), '.bun', 'bin', 'bun');

    const findBun = () => {
        if (noBun) return null;
        // Check local install first
        if (existsSync(localBun)) return localBun;
        // Check PATH
        try {
            const cmd = isWindows ? 'where bun' : 'command -v bun';
            return execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0];
        } catch {
            return null;
        }
    };

    const bunPath = findBun();

    // If Bun is found and we're not already proxied, re-exec under Bun
    if (bunPath && !isBunProxy) {
        const result = spawnSync(bunPath, [__filename, ...process.argv.slice(2)], {
            stdio: 'inherit',
            env: { ...process.env, MEMORYBLOCK_BUN_PROXY: '1' },
        });
        process.exit(result.status ?? 1);
    }

    // ─── No Bun Available: Run on Node.js ────────────────────────────
    // Show a one-time hint about Bun (only in interactive terminal, not in daemons/CI)
    if (!bunPath && !noBun && !isMblkDaemon && process.stdout.isTTY) {
        showBunHintOnce();
    }

    try {
        await import(entryPath);
    } catch (err) {
        console.error('❌ Failed to load memoryblock CLI.');
        console.error('   This usually means the package was not built correctly.');
        console.error('   Try reinstalling: npm install -g memoryblock');
        if (err && typeof err === 'object' && 'message' in err) {
            console.error(`\n   Error: ${err.message}`);
        }
        process.exit(1);
    }
}

// ─── One-time Bun recommendation ─────────────────────────────────────
// Shows once ever. Persists a flag in ~/.memoryblock/.bun-hint-shown
function showBunHintOnce() {
    try {
        const mblkHome = join(homedir(), '.memoryblock');
        const flagFile = join(mblkHome, '.bun-hint-shown');

        if (existsSync(flagFile)) return; // Already shown

        // Show the hint
        const installCmd = isWindows
            ? 'powershell -c "irm bun.sh/install.ps1 | iex"'
            : 'curl -fsSL https://bun.sh/install | bash';

        console.log('');
        console.log('  \x1b[33m⚡ Tip:\x1b[0m memoryblock runs ~2x faster with \x1b[1mBun\x1b[0m (optional).');
        console.log(`  Install: \x1b[2m${installCmd}\x1b[0m`);
        console.log('  Skip this: \x1b[2mMEMORYBLOCK_NO_BUN=1\x1b[0m');
        console.log('');

        // Mark as shown (never show again)
        mkdirSync(mblkHome, { recursive: true });
        writeFileSync(flagFile, new Date().toISOString());
    } catch {
        // Never fail over a hint
    }
}