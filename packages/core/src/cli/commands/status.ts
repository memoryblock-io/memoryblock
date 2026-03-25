import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import {
    loadGlobalConfig, resolveBlocksDir, loadPulseState, loadBlockConfig, isInitialized,
} from '../../utils/config.js';
import { pathExists } from '../../utils/fs.js';
import { log } from '../logger.js';
import { t } from '@memoryblock/locale';
import type { BlockStatus } from '@memoryblock/types';

const STATUS_ICON: Record<BlockStatus, string> = {
    SLEEPING: chalk.gray('💤'),
    ACTIVE: chalk.green('🟢'),
    BUSY: chalk.yellow('🔶'),
    ERROR: chalk.red('🔴'),
};

export async function statusCommand(): Promise<void> {
    if (!(await isInitialized())) {
        log.error(t.general.notInitialized);
        process.exit(1);
    }

    const globalConfig = await loadGlobalConfig();
    const blocksDir = resolveBlocksDir(globalConfig);

    if (!(await pathExists(blocksDir))) {
        log.info(t.general.noBlocksDir);
        return;
    }

    const entries = await fsp.readdir(blocksDir, { withFileTypes: true });
    const blocks = entries.filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'));

    log.brand(`Status — ${blocks.length} block(s)\n`);

    if (blocks.length === 0) {
        console.log(`  ${chalk.dim(t.status.noActive)}`);
    }

    for (const block of blocks) {
        const blockPath = join(blocksDir, block.name);
        try {
            const config = await loadBlockConfig(blockPath);
            const pulse = await loadPulseState(blockPath);
            const icon = STATUS_ICON[pulse.status] || '❓';

            console.log(`  ${icon} ${chalk.bold(config.name)} ${chalk.dim(`(${pulse.status})`)}`);
            if (pulse.currentTask) {
                console.log(`     ${chalk.dim('Task:')} ${pulse.currentTask}`);
            }
            if (pulse.lastRun) {
                console.log(`     ${chalk.dim('Last:')} ${pulse.lastRun}`);
            }
            if (pulse.error) {
                console.log(`     ${chalk.red('Error:')} ${pulse.error}`);
            }
        } catch {
            console.log(`  ❓ ${chalk.bold(block.name)} ${chalk.dim(`(${t.status.invalidConfig})`)}`);
        }
    }

    // Show archived blocks
    const archiveDir = join(blocksDir, '_archive');
    if (await pathExists(archiveDir)) {
        try {
            const archiveEntries = await fsp.readdir(archiveDir, { withFileTypes: true });
            const archived = archiveEntries.filter(e => e.isDirectory());

            if (archived.length > 0) {
                console.log('');
                console.log(`  ${chalk.dim(t.status.archived(archived.length))}`);
                for (const a of archived) {
                    // Extract block name and date from "name_2026-03-21T10-33-24-242Z"
                    const match = a.name.match(/^(.*?)_(\d{4}-\d{2}-\d{2})T/);
                    const name = match ? match[1] : a.name;
                    const date = match ? match[2] : '';
                    console.log(`     ${chalk.dim('·')} ${chalk.dim(name)}${date ? chalk.dim(` (${date})`) : ''}`);
                }
                console.log('');
                console.log(`     ${chalk.dim(t.status.restoreHint)}`);
            }
        } catch {
            // Archive dir exists but can't be read — skip
        }
    }

    console.log('');
}
