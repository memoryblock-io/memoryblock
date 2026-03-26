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

let bunPath = run('command -v bun');
const localBun = path.join(os.homedir(), '.bun', 'bin', 'bun');

// 1. Install Bun if missing
if (!bunPath) {
    if (fs.existsSync(localBun)) {
        bunPath = localBun;
    } else {
        console.log('\n⚡ \x1b[1mmemoryblock\x1b[0m is powered by \x1b[33mBun\x1b[0m for extreme performance.');
        console.log('   Installing the lightweight engine automatically...\n');
        try {
            execSync('curl -fsSL https://bun.sh/install | bash', { stdio: 'inherit' });
            bunPath = localBun;
            console.log('\n✅ Bun installed successfully!');
        } catch (e) {
            console.error('\n❌ Failed to install Bun. Please install it manually: https://bun.sh');
            process.exit(1);
        }
    }
}

// 2. Identify global path
const globalRoot = run('npm root -g');
if (!globalRoot) {
    console.error('❌ Failed to locate global npm root. Please verify your Node installation.');
    process.exit(1);
}

// 3. Install @memoryblock/cli if missing
const cliScript = path.join(globalRoot, '@memoryblock/cli', 'bin', 'mblk.js');

if (!fs.existsSync(cliScript)) {
    console.log('\n📦 Downloading memoryblock terminal interface tools...\n');
    try {
        execSync('npm install -g @memoryblock/cli@latest', { stdio: 'inherit' });
    } catch (e) {
        console.error('\n❌ Failed to sync @memoryblock/cli. Please run manually: npm install -g @memoryblock/cli');
        process.exit(1);
    }
}

// 4. Hand-off execution seamlessly to Bun, passing all CLI arguments
const result = spawnSync(bunPath, [cliScript, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);