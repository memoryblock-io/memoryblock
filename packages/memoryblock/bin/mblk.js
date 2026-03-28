#!/usr/bin/env node

/**
 * memoryblock CLI — Universal Entry Point
 *
 * This is the bin proxy installed by `npm install -g memoryblock`.
 * It ensures Bun is available (auto-installing if needed), then re-executes
 * itself under Bun for optimal performance.
 *
 * If Bun is already the runtime, we skip the proxy and run the CLI directly.
 *
 * Design:
 *   npm install -g memoryblock  →  symlinks `mblk` to this file
 *   User runs `mblk start`     →  this script detects Node, installs bun, re-execs via bun
 *   Subsequent runs             →  bun is found immediately, re-exec is instant
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Step 0: Are we already running under Bun? ──────────────────────
// If yes, skip the proxy and run the CLI entry point directly.
const isBun = typeof globalThis.Bun !== 'undefined';

if (isBun) {
    // Running under Bun — load the compiled CLI entry point
    // This file is at:   packages/memoryblock/bin/mblk.js
    // Entry point is at: packages/memoryblock/dist/entry.js
    const entryPath = join(__dirname, '..', 'dist', 'entry.js');
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
} else {
    // ─── Step 1: Running under Node.js — find or install Bun ─────────
    const localBun = join(homedir(), '.bun', 'bin', 'bun');

    const findBun = () => {
        try {
            return execSync('command -v bun', { stdio: 'pipe' }).toString().trim();
        } catch {
            return null;
        }
    };

    let bunPath = findBun();

    if (!bunPath && !existsSync(localBun)) {
        console.log('\n⚡ \x1b[1mmemoryblock\x1b[0m is powered by \x1b[33mBun\x1b[0m for extreme performance.');
        console.log('   Installing the lightweight engine automatically...\n');
        try {
            execSync('curl -fsSL https://bun.sh/install | bash', { stdio: 'inherit' });
            bunPath = localBun;
            console.log('\n✅ Bun installed successfully!\n');
        } catch {
            console.error('\n❌ Failed to install Bun automatically.');
            console.error('   Please install manually: curl -fsSL https://bun.sh/install | bash');
            process.exit(1);
        }
    }

    if (!bunPath) bunPath = localBun;

    // ─── Step 2: Re-execute this same file under Bun ─────────────────
    // Bun will detect itself as the runtime and take the fast path above.
    const result = spawnSync(bunPath, [__filename, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: { ...process.env, MEMORYBLOCK_BUN_PROXY: '1' },
    });

    process.exit(result.status ?? 1);
}