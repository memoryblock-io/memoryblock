/**
 * pnpm dev:reset — developer reset for the monorepo.
 * 
 * Default: unlink global mblk, remove node_modules, remove dist/, remove tsbuildinfo
 * --hard:  also wipe ~/.memoryblock global workspace
 */

const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const os = require('os');
const fs = require('fs');

const args = process.argv.slice(2);
const isHard = args.includes('--hard');

function run(cmd, silent = true) {
    try {
        execSync(cmd, { stdio: silent ? 'ignore' : 'inherit' });
        return true;
    } catch {
        return false;
    }
}

async function main() {
    // Show starting logo
    run('node scripts/status.js start:reset', false);

    if (isHard) {
        // Require confirmation for hard reset
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
            rl.question('\n\x1b[33m⚠  --hard will wipe ~/.memoryblock global workspace. Continue? (y/n): \x1b[0m', resolve);
        });
        rl.close();

        if (answer.trim().toLowerCase() !== 'y') {
            console.log('\x1b[2m  cancelled.\x1b[0m\n');
            process.exit(0);
        }
    }

    // 1. Stop any running processes (PID file + port failsafe)
    process.stdout.write('\n\x1b[2m  stopping processes...\x1b[0m');
    run('pnpm -s stop');

    // Kill server by PID file if available
    const pidFile = path.join(os.homedir(), '.memoryblock', 'server.pid');
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        if (!isNaN(pid)) { run(`kill ${pid}`); }
        // fs.unlinkSync(pidFile); // Will be wiped by rm -rf if hard
    } catch { /* no PID file */ }

    // Failsafe: kill any orphan process on the default server port (8420)
    run('lsof -ti:8420 | xargs kill -9 2>/dev/null');
    console.log(' \x1b[32m✓\x1b[0m');

    // 2. Unlink global mblk
    process.stdout.write('\x1b[2m  unlinking mblk globally...\x1b[0m');
    run('npm unlink -g @memoryblock/cli');
    run('npm unlink -g memoryblock');
    console.log(' \x1b[32m✓\x1b[0m');

    // 3. Remove node_modules, dist, tsbuildinfo
    process.stdout.write('\x1b[2m  cleaning build artifacts...\x1b[0m');
    run('rm -rf node_modules packages/*/node_modules packages/plugins/*/node_modules packages/*/dist packages/plugins/*/dist *.tsbuildinfo');
    console.log(' \x1b[32m✓\x1b[0m');

    // 4. Hard: wipe global workspace
    if (isHard) {
        process.stdout.write('\x1b[2m  wiping global .memoryblock workspace...\x1b[0m');
        run(`rm -rf ${path.join(os.homedir(), '.memoryblock')}`);
        // Also wipe mblk and memoryblock-ws if they exist locally from previous botched attempts
        run('rm -rf mblk memoryblock-ws _playground/memoryblock-ws');
        console.log(' \x1b[32m✓\x1b[0m');
    }

    // 5. Final status
    run('node scripts/status.js reset', false);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});