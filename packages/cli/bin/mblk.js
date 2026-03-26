#!/usr/bin/env node

import('../dist/bin/mblk.js').catch(() => {
  console.error('memoryblock CLI not built yet. Run `pnpm dev:build` first.');
  process.exit(1);
});