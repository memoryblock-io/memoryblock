#!/usr/bin/env node

/**
 * memoryblock — Universal Postinstall
 *
 * Runs after `npm/bun/pnpm/yarn install -g memoryblock`.
 * Handles:
 *   1. Smart symlink creation for the `mblk` binary
 *   2. Stale symlink cleanup from previous installations
 *   3. Conflict detection (multiple mblk binaries from different package managers)
 *   4. Cross-platform support (macOS, Linux, Windows)
 *
 * Designed to never fail — all errors are caught and reported as warnings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = path.resolve(__dirname, 'mblk.js');
const isWindows = platform() === 'win32';

// ─── Detect if this is a global install ──────────────────────────────
// Different package managers set different env vars.
const isGlobal =
    process.env.npm_config_global === 'true' ||       // npm
    process.env.BUN_INSTALL !== undefined ||           // bun (global context)
    process.env.PNPM_HOME !== undefined ||             // pnpm global
    process.env.npm_config_prefix?.includes('.bun') || // bun via npm compat
    // Heuristic: if our install path is inside a global-looking directory
    __dirname.includes('/lib/node_modules/') ||
    __dirname.includes('\\node_modules\\memoryblock\\');

// For local/dev installs within a monorepo, skip postinstall
if (!isGlobal) {
    process.exit(0);
}

// ─── Conflict Detection ─────────────────────────────────────────────
function findExistingMblk() {
    const locations = [];

    // Check common binary directories
    const searchPaths = isWindows
        ? []
        : ['/usr/local/bin/mblk', '/usr/bin/mblk'];

    // Add Bun global bin
    const bunBin = path.join(homedir(), '.bun', 'bin', 'mblk');
    searchPaths.push(bunBin);

    // Check PATH for any `mblk` binary
    try {
        const cmd = isWindows ? 'where mblk 2>nul' : 'command -v mblk 2>/dev/null';
        const found = execSync(cmd, { stdio: 'pipe' }).toString().trim();
        if (found) {
            for (const p of found.split('\n')) {
                const trimmed = p.trim();
                if (trimmed && !locations.includes(trimmed)) {
                    locations.push(trimmed);
                }
            }
        }
    } catch { /* not found in PATH */ }

    // Check known locations
    for (const target of searchPaths) {
        try {
            if (fs.existsSync(target) && !locations.includes(target)) {
                locations.push(target);
            }
        } catch { /* skip */ }
    }

    return locations;
}

function resolveLink(linkPath) {
    try {
        return fs.realpathSync(linkPath);
    } catch {
        return null;
    }
}

// ─── Smart Linking ───────────────────────────────────────────────────
function smartLink() {
    if (isWindows) {
        // Windows: npm/bun handle .cmd wrapper creation automatically.
        // Just report status.
        return;
    }

    const targets = ['/usr/local/bin/mblk', '/usr/bin/mblk'];

    for (const target of targets) {
        try {
            if (fs.existsSync(target)) {
                const real = resolveLink(target);

                // Already points to us — nothing to do
                if (real === source) {
                    return;
                }

                // Stale symlink (target doesn't exist anymore)
                if (!real || !fs.existsSync(real)) {
                    fs.unlinkSync(target);
                    fs.symlinkSync(source, target);
                    console.log(`\n🔗 memoryblock: Replaced stale symlink at ${target}`);
                    return;
                }

                // Points to a different, valid installation — leave it alone but warn
                // (the user may have a newer or different version)
                return;
            }

            // Target doesn't exist — create fresh symlink
            fs.symlinkSync(source, target);
            console.log(`\n🔗 memoryblock: Linked 'mblk' to ${target}`);
            return;
        } catch {
            // Permission denied or other error — try next target
            continue;
        }
    }
}

// ─── Conflict Report ─────────────────────────────────────────────────
function reportConflicts() {
    const existing = findExistingMblk();
    if (existing.length <= 1) return; // No conflict

    // Multiple mblk binaries found — warn the user
    console.log('\n⚠️  memoryblock: Multiple \'mblk\' binaries detected:');
    for (const loc of existing) {
        const real = resolveLink(loc);
        const label = real && real !== loc ? ` → ${real}` : '';
        const isOurs = real === source ? ' (this installation)' : '';
        console.log(`   • ${loc}${label}${isOurs}`);
    }
    console.log('   The first one in your PATH will be used.');
    console.log('   To resolve: remove duplicates or adjust your PATH.\n');
}

// ─── Execute ─────────────────────────────────────────────────────────
try {
    smartLink();
    reportConflicts();
} catch {
    // Postinstall must never fail the installation
}