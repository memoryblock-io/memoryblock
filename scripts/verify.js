const { execSync } = require('child_process');

const args = process.argv.slice(2);
const isCI = process.env.CI === 'true' || args.includes('--skip-setup');

function run(cmd, silent = true) {
    try {
        execSync(cmd, { stdio: silent ? 'ignore' : 'inherit' });
    } catch (e) {
        if (!silent) console.error(e);
        process.exit(1);
    }
}

// 1. Show starting logo 
if (!isCI) {
    run('node scripts/status.js start:verify', false);
}

// 2. Run the actual failsafe check
const failsafeArgs = args.join(' ');
run(`node scripts/failsafe.js ${failsafeArgs}`, false);

// 3. Show final completion status
if (!isCI) {
    run('node scripts/status.js verify', false);
} else {
    console.log('\n🛡️  \x1b[32m\x1b[1mmemoryblock verification passed!\x1b[0m');
}
