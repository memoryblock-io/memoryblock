import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    package: { type: 'string', short: 'p' },
    version: { type: 'string', short: 'v' },
    'dry-run': { type: 'boolean', short: 'd' },
  },
  allowPositionals: true
});

if (!values.package || !values.version) {
  console.error("Usage: node scripts/getpub.js -p <package-name> -v <version> [--dry-run]");
  process.exit(1);
}

const pkgName = values.package;
const pkgVersion = values.version;
const isDryRun = values['dry-run'] || false;

console.log(`\n📦 PREPARE INITIAL PUBLISH`);
console.log(`--------------------------`);
console.log(`Package: ${pkgName}`);
console.log(`Version: ${pkgVersion}`);
console.log(`Dry Run: ${isDryRun ? 'Yes' : 'No'}`);
console.log(`--------------------------\n`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Do you want to proceed and publish this placeholder package? (y/N): ', (answer) => {
  rl.close();
  
  if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
    console.log('Publish aborted.');
    process.exit(0);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getpub-'));
  console.log(`\nCreated temporary directory: ${tmpDir}`);

  const pkgJson = {
    name: pkgName,
    version: pkgVersion,
    description: `Placeholder repository for ${pkgName} prior to automated CI release.`,
    author: "Ghazi <https://mgks.dev>",
    repository: {
      type: "git",
      url: "git+https://github.com/memoryblock-io/memoryblock.git"
    },
    license: "MIT"
  };

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  console.log('Created bare-minimum package.json.');

  if (isDryRun) {
    console.log('\n[DRY RUN] Would execute: npm login');
    console.log(`[DRY RUN] Would execute: npm publish --access public inside ${tmpDir}`);
    console.log('[DRY RUN] Cleaning up temporary directory...');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Done.');
    process.exit(0);
  }

  try {
    console.log('\nLogging into NPM...');
    execSync('npm login', { stdio: 'inherit' });

    console.log(`\nPublishing ${pkgName}@${pkgVersion} to NPM...`);
    execSync('npm publish --access public', { cwd: tmpDir, stdio: 'inherit' });

    console.log('\nSuccessfully published!');
  } catch (err) {
    console.error(`\nFailed during npm publish steps: ${err.message}`);
  } finally {
    console.log('Cleaning up temporary directory...');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Cleanup complete.');
  }
});
