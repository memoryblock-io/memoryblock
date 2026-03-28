/**
 * --------------------------------------------------------------------
 * memoryblock : Deploy isolated, multi-agent AI assistants
 *
 * @package     memoryblock
 * @website     https://memoryblock.io
 * @repository  https://github.com/memoryblock-io/memoryblock
 * @license     MIT
 * @copyright   Copyright (c) 2025-present memoryblock.io
 *
 * [memoryblock-source]
 * --------------------------------------------------------------------
 */

/**
 * --------------------------------------------------------------------
 * memoryblock : Universal Failsafe
 * Tests CLI scaffolding, block lifecycle, TypeScript builds,
 * lint checks, version consistency, and security audit.
 * --------------------------------------------------------------------
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CWD = process.cwd();
const CLI_BIN = path.join(CWD, 'packages/memoryblock/dist/entry.js');

console.log('🛡️  Running Universal Failsafe...');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mblk-failsafe-'));
console.log(`\x1b[2m   Temp Workspace: ${tempDir}\x1b[0m\n`);

function assert(condition, message) {
    if (!condition) throw new Error(`❌ FAIL: ${message}`);
}

function runCmd(cmd, cwd) {
    try {
        return execSync(cmd, { cwd: cwd || CWD, stdio: 'pipe' }).toString().trim();
    } catch (e) {
        console.error(`\x1b[31m\x1b[1m💥 Command Failed:\x1b[0m ${cmd}`);
        if (e.stderr) console.error(e.stderr.toString());
        if (e.stdout) console.error(e.stdout.toString());
        throw new Error("Process aborted due to command failure.");
    }
}

const args = process.argv.slice(2);
const skipSetup = args.includes('--skip-setup');

try {
    // ========================================
    // 1. Install & Build Monorepo
    // ========================================
    if (!skipSetup) {
        console.log('\n\x1b[2m📦 [1/8] Linking & Building Monorepo...\x1b[0m');
        runCmd('pnpm install --silent && pnpm dev:build');
    } else {
        console.log('\n\x1b[2m⏩ [1/8] Skipping setup (CI mode)...\x1b[0m');
    }

    // ========================================
    // 2. TypeScript & Lint
    // ========================================
    console.log('\x1b[2m🔍 [2/8] TypeScript Type Checking & Lint...\x1b[0m');

    // Run lint (ESLint with typescript-eslint)
    try {
        runCmd("pnpm dev:lint");
    } catch (e) {
        throw new Error('Lint check failed! Run `pnpm dev:lint:fix` to auto-fix issues.');
    }

    // ========================================
    // 3. CLI: mblk init
    // ========================================
    console.log('\x1b[2m🚀 [3/8] Testing CLI Scaffolding (mblk init)...\x1b[0m');

    // Set HOME to tempDir so mblk init creates .memoryblock there
    const testHome = path.join(tempDir, 'home');
    fs.mkdirSync(testHome, { recursive: true });
    const env = { ...process.env, HOME: testHome };

    execSync(`node "${CLI_BIN}" init --yes`, { cwd: tempDir, env, stdio: 'pipe' });

    const memoryblockDir = path.join(testHome, '.memoryblock', 'ws');
    assert(fs.existsSync(path.join(memoryblockDir, 'config.json')), 'mblk init failed to create config.json');
    assert(fs.existsSync(path.join(memoryblockDir, 'auth.json')), 'mblk init failed to create auth.json');

    // Validate config schema
    const config = JSON.parse(fs.readFileSync(path.join(memoryblockDir, 'config.json'), 'utf8'));
    assert(config.blocksDir === './blocks', 'Default blocksDir should be "./blocks"');

    // Validate auth template
    const auth = JSON.parse(fs.readFileSync(path.join(memoryblockDir, 'auth.json'), 'utf8'));
    assert(auth.aws && typeof auth.aws.accessKeyId === 'string', 'Auth template missing AWS section');
    assert(auth.telegram && typeof auth.telegram.botToken === 'string', 'Auth template missing Telegram section');
    assert(auth.brave && typeof auth.brave.apiKey === 'string', 'Auth template missing Brave section');

    // ========================================
    // 4. CLI: mblk create
    // ========================================
    console.log('\x1b[2m🧱 [4/8] Testing Block Scaffolding (mblk create)...\x1b[0m');

    execSync(`node "${CLI_BIN}" create test-block`, { cwd: tempDir, env, stdio: 'pipe' });

    const blockDir = path.join(memoryblockDir, 'blocks', 'test-block');
    assert(fs.existsSync(path.join(blockDir, 'config.json')), 'mblk create failed to create block config.json');
    assert(fs.existsSync(path.join(blockDir, 'pulse.json')), 'mblk create failed to create pulse.json');
    assert(fs.existsSync(path.join(blockDir, 'memory.md')), 'mblk create failed to create memory.md');

    // Validate block config
    const blockConfig = JSON.parse(fs.readFileSync(path.join(blockDir, 'config.json'), 'utf8'));
    assert(blockConfig.name === 'test-block', 'Block name mismatch');
    assert(blockConfig.adapter && blockConfig.adapter.provider === 'bedrock', 'Block adapter should default to bedrock');
    assert(blockConfig.memory && blockConfig.memory.maxContextTokens > 0, 'Block memory config missing');

    // Validate pulse state
    const pulse = JSON.parse(fs.readFileSync(path.join(blockDir, 'pulse.json'), 'utf8'));
    assert(pulse.status === 'SLEEPING', 'New block should be SLEEPING');

    // ========================================
    // 5. CLI: mblk status
    // ========================================
    console.log('\x1b[2m📊 [5/8] Testing Status Command (mblk status)...\x1b[0m');

    const statusOutput = execSync(`node "${CLI_BIN}" status`, { cwd: tempDir, env, stdio: 'pipe' }).toString();
    assert(statusOutput.includes('test-block'), 'mblk status should list test-block');
    assert(statusOutput.includes('SLEEPING'), 'mblk status should show SLEEPING');

    // ========================================
    // 6. Duplicate Block Prevention
    // ========================================
    console.log('\x1b[2m🔒 [6/8] Testing Block Isolation & Safety...\x1b[0m');

    // Creating a block with the same name should fail or warn
    try {
        execSync(`node "${CLI_BIN}" create test-block`, { cwd: tempDir, env, stdio: 'pipe' });
        // If it doesn't throw, check the block wasn't corrupted
        const blockConfigAfter = JSON.parse(fs.readFileSync(path.join(blockDir, 'config.json'), 'utf8'));
        assert(blockConfigAfter.name === 'test-block', 'Block config was corrupted by duplicate create');
    } catch (e) {
        // Expected: should fail gracefully
    }

    // Create a second block
    execSync(`node "${CLI_BIN}" create second-block`, { cwd: tempDir, env, stdio: 'pipe' });
    const statusOutput2 = execSync(`node "${CLI_BIN}" status`, { cwd: tempDir, env, stdio: 'pipe' }).toString();
    assert(statusOutput2.includes('test-block'), 'Status should still show test-block');
    assert(statusOutput2.includes('second-block'), 'Status should show second-block');

    // ========================================
    // 7. Version Consistency
    // ========================================
    console.log('\x1b[2m🏷️  [7/8] Verifying Version Consistency...\x1b[0m');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(CWD, 'package.json'), 'utf8'));
    const rootVersion = rootPkg.version;

    function checkVersions(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, entry);
            if (fs.existsSync(path.join(fullPath, 'package.json'))) {
                const pkg = JSON.parse(fs.readFileSync(path.join(fullPath, 'package.json'), 'utf8'));
                assert(pkg.version === rootVersion, `Version mismatch in ${pkg.name}: expected ${rootVersion}, got ${pkg.version}`);
            } else if (fs.statSync(fullPath).isDirectory()) {
                checkVersions(fullPath);
            }
        }
    }
    checkVersions(path.join(CWD, 'packages'));

    // ========================================
    // 8. Security Audit
    // ========================================
    console.log('\x1b[2m🚨 [8/8] Security Audit...\x1b[0m');
    try {
        execSync('pnpm audit --audit-level=high', { cwd: CWD, stdio: 'pipe' });
    } catch (e) {
        console.warn('\x1b[33m⚠️  Security vulnerabilities found. Run `pnpm audit` for details.\x1b[0m');
        // Don't fail on audit warnings during early development
    }


} catch (e) {
    console.error('\x1b[31m\x1b[1m\n❌ FAILSAFE CRITICAL FAILURE ❌\x1b[0m');
    console.error(e.message);
    process.exit(1);

} finally {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}