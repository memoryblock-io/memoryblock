import { join } from 'node:path';
import { ensureDir, writeJson, atomicWrite, pathExists } from '../../utils/fs.js';
import {
    loadGlobalConfig, resolveBlockPath, isInitialized,
} from '../../utils/config.js';
import { BlockConfigSchema, PulseStateSchema } from '@memoryblock/types';
import { log } from '../logger.js';
import { FILE_TEMPLATES } from '../../engine/prompts.js';


// Templates moved to prompts.ts

export async function createCommand(blockName: string): Promise<void> {
    if (!(await isInitialized())) {
        throw new Error('Not initialized. Run `mblk init` first.');
    }

    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(blockName)) {
        throw new Error('Block name must start with a letter/number and contain only lowercase letters, numbers, and hyphens (max 32 chars).');
    }

    const globalConfig = await loadGlobalConfig();
    const blockPath = resolveBlockPath(globalConfig, blockName);

    if (await pathExists(blockPath)) {
        throw new Error(`Block "${blockName}" already exists at ${blockPath}`);
    }

    log.brand(`Creating block: ${blockName}\n`);

    // Directory structure
    await ensureDir(blockPath);
    await ensureDir(join(blockPath, 'agents'));
    await ensureDir(join(blockPath, 'logs'));

    // Block config (inherits global defaults)
    const blockConfig = BlockConfigSchema.parse({
        name: blockName,
        adapter: globalConfig.defaults.adapter,
        memory: globalConfig.defaults.memory,
        pulse: globalConfig.defaults.pulse,
    });
    await writeJson(join(blockPath, 'config.json'), blockConfig);
    log.success('Created config.json');

    // Initial pulse state
    const pulse = PulseStateSchema.parse({});
    await writeJson(join(blockPath, 'pulse.json'), pulse);
    log.success('Created pulse.json');

    // Core identity files
    await atomicWrite(join(blockPath, 'memory.md'), FILE_TEMPLATES.MEMORY_MD);
    log.success('Created memory.md');

    await atomicWrite(join(blockPath, 'monitor.md'), FILE_TEMPLATES.MONITOR_MD(blockName));
    log.success('Created monitor.md');

    console.log('');
    log.brand(`Block "${blockName}" is ready.`);
    log.dim(`  Path: ${blockPath}`);
    log.dim(`  Start: mblk start ${blockName}`);
}