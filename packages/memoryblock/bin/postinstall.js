#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only run smart-linking if this is a global npm install
if (process.env.npm_config_global !== 'true') {
    process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = path.resolve(__dirname, 'mblk.js');

const targets = process.platform === 'win32' 
    ? [] // Windows users rely on npm's .cmd wrapper generation
    : ['/usr/local/bin/mblk', '/usr/bin/mblk'];

let linked = false;

for (const target of targets) {
    try {
        if (!fs.existsSync(target)) {
            fs.symlinkSync(source, target);
            console.log(`\n🔗 memoryblock: Smart-linked 'mblk' to ${target}`);
            linked = true;
            break;
        } else {
            // Check if it already properly links to us
            const real = fs.realpathSync(target);
            if (real === source) {
                linked = true;
                break;
            }
        }
    } catch (e) {
        // Silently skip permission errors (`EACCES`). We try our best!
    }
}