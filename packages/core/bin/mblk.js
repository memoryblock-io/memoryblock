#!/usr/bin/env node
/**
 * memoryblock - Auto-Bootstrap CLI Wrapper
 * 
 * Ensures the end-user has a flawless zero-configuration setup.
 * Automatically checks and installs Bun (the high-performance runtime) 
 * and the @memoryblock/cli ecosystem tools if they are missing.
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Helper to silently run commands
const run = (cmd) => {
    try {
        return execSync(cmd, { stdio: 'pipe' }).toString().trim();
    } catch {
        return null;
    }
};

const localBun = path.join(os.homedir(), '.bun', 'bin', 'bun');
const bunGlobalRoot = path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules');
const cliScriptBun = path.join(bunGlobalRoot, '@memoryblock/cli', 'bin', 'mblk.js');

// 0ms Fast-Path: If everything is already installed natively, skip ALL slow checks!
if (fs.existsSync(localBun) && fs.existsSync(cliScriptBun)) {
    const result = spawnSync(localBun, [cliScriptBun, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}

// Check package managers (Slow Path)
let bunPath = run('command -v bun');
const hasNpm = !!run('command -v npm');
const hasBunFn = !!run('command -v bun');

// 1. Install Bun if completely missing
if (!hasBunFn && !fs.existsSync(localBun)) {
    console.log('\n⚡ \x1b[1mmemoryblock\x1b[0m is powered by \x1b[33mBun\x1b[0m for extreme performance.');
    console.log('   Installing the lightweight engine automatically...\n');
    try {
        execSync('curl -fsSL https://bun.sh/install | bash', { stdio: 'inherit' });
        bunPath = localBun;
        console.log('\n✅ Bun installed successfully!');
    } catch (e) {
        console.error('\n❌ Failed to automatically install Bun. Please run: curl -fsSL https://bun.sh/install | bash');
        process.exit(1);
    }
}
if (!bunPath) bunPath = localBun;

// 2. Identify global path & manager
const npmGlobalRoot = hasNpm ? run('npm root -g') : null;
let cliScript = cliScriptBun;

// 3. Install @memoryblock/cli if missing
// (We also gracefully check if NPM already downloaded it first so we don't redownload)
if (!fs.existsSync(cliScript) && npmGlobalRoot) {
    const npmScript = path.join(npmGlobalRoot, '@memoryblock/cli', 'bin', 'mblk.js');
    if (fs.existsSync(npmScript)) cliScript = npmScript;
}

if (!fs.existsSync(cliScript)) {
    console.log('\n📦 Downloading memoryblock terminal interface tools...\n');
    try {
        execSync(`${bunPath} install -g @memoryblock/cli@latest`, { stdio: 'inherit' });
        cliScript = path.join(bunGlobalRoot, '@memoryblock/cli', 'bin', 'mblk.js');
    } catch (e) {
        if (hasNpm) {
            console.log('\n⚠️ Bun global install tripped. Falling back to NPM...\n');
            try {
                execSync('npm install -g @memoryblock/cli@latest', { stdio: 'inherit' });
                cliScript = path.join(npmGlobalRoot, '@memoryblock/cli', 'bin', 'mblk.js');
            } catch (err) {
                console.error('\n❌ Failed to sync @memoryblock/cli. Please run manually: npm install -g @memoryblock/cli');
                process.exit(1);
            }
        } else {
            console.error(`\n❌ Failed to sync @memoryblock/cli. Please run manually: ${bunPath} install -g @memoryblock/cli`);
            process.exit(1);
        }
    }
}

// 4. Hand-off execution seamlessly to Bun, passing all CLI arguments
const result = spawnSync(bunPath, [cliScript, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);