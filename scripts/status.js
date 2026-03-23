
const LOGO = `

 █▀▄▀█ █▀▀ █▀▄▀█ █▀█ █▀█ █▄█ █▄▄ █░░ █▀█ █▀▀ █▄▀
 █░▀░█ ██▄ █░▀░█ █▄█ █▀▄ ░█░ █▄█ █▄▄ █▄█ █▄▄ █░█ 

`;

const TYPE = process.argv[2];

const IS_START = TYPE.startsWith('start:');

if (IS_START) {
    console.log('\x1b[34m%s\x1b[0m', LOGO);
    console.log('\x1b[2m Dev Environment \x1b[0m\n\n');
}

if (TYPE === 'start:reset') {
    process.stdout.write('🫧  \x1b[1mResetting memoryblock...\x1b[0m \x1b[2m(cleaning up)\x1b[0m');
} else if (TYPE === 'start:verify') {
    process.stdout.write('🛡️  \x1b[1mVerifying memoryblock...\x1b[0m \x1b[2m(running failsafe checks)\x1b[0m');
} else if (TYPE === 'reset') {
    console.log('\n\x1b[32m✅ Reset complete!\x1b[0m\n');
    console.log('\x1b[34m🛑 Any running processes stopped.\x1b[0m');
    console.log('\x1b[34m🔗 Global links and binaries removed.\x1b[0m');
    console.log('\x1b[34m🧹 Monorepo cleaned.\x1b[0m');
    console.log('\x1b[32m\n⚡️ You can start fresh now.\x1b[0m');

} else if (TYPE === 'verify') {
    console.log('\n\x1b[32m✨ Failsafe verification passed!\x1b[0m\n');
    console.log('\x1b[34m✅ Dependencies & monorepo links verified.\x1b[0m');
    console.log('\x1b[34m✅ TypeScript builds passed.\x1b[0m');
    console.log('\x1b[34m✅ CLI commands verified.\x1b[0m');
    console.log('\x1b[34m✅ Block scaffolding lifecycle verified.\x1b[0m');
    console.log('\x1b[34m✅ Lint checks passed.\x1b[0m');
    console.log('\x1b[34m✅ Security audit & version consistency passed.\x1b[0m');
    console.log('\x1b[32m\n🛡️  memoryblock is ready!\x1b[0m');
}

console.log('\n');