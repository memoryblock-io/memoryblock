import { log } from '@memoryblock/core';
import { loadGlobalConfig, resolveBlockPath } from '@memoryblock/core';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { FILE_TEMPLATES } from '@memoryblock/core';

/**
 * mblk reset <block>        — Light cleanup: reset memory, pulse, costs, session
 * mblk reset <block> --hard  — Full wipe: also deletes logs/ (with confirmation)
 */
export async function resetCommand(blockName: string, options: { hard?: boolean }): Promise<void> {
    const globalConfig = await loadGlobalConfig();
    const blockPath = resolveBlockPath(globalConfig, blockName);

    // Verify block exists
    try {
        await fsp.access(blockPath);
    } catch {
        throw new Error(`Block "${blockName}" not found at ${blockPath}`);
    }

    // --hard requires confirmation
    if (options.hard) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow(`\n⚠  --hard will wipe ALL data for "${blockName}" (logs, memory, session). Continue? (y/n): `), resolve);
        });
        rl.close();

        if (answer.trim().toLowerCase() !== 'y') {
            log.dim('  cancelled.');
            return;
        }
    }

    log.dim(`  resetting ${blockName}${options.hard ? ' (hard)' : ''}...`);

    // Light reset: memory, pulse, costs, session, chat.json, and logs directory
    const filesToReset = ['memory.md', 'pulse.json', 'costs.json', 'session.json', 'chat.json'];

    for (const file of filesToReset) {
        const filePath = join(blockPath, file);
        try {
            await fsp.access(filePath);
            if (file === 'memory.md') {
                await fsp.writeFile(filePath, FILE_TEMPLATES.MEMORY_MD, 'utf-8');
            } else if (file === 'pulse.json') {
                await fsp.writeFile(filePath, JSON.stringify(FILE_TEMPLATES.PULSE_JSON, null, 4), 'utf-8');
            } else if (file === 'costs.json') {
                await fsp.writeFile(filePath, JSON.stringify(FILE_TEMPLATES.COSTS_JSON, null, 4), 'utf-8');
            } else if (file === 'session.json' || file === 'chat.json') {
                await fsp.unlink(filePath);
            }
            log.dim(`  ✓ ${file}`);
        } catch {
            // Skip if file doesn't exist
        }
    }

    // Wipe logs continuously for both soft and hard resets
    const logsDir = join(blockPath, 'logs');
    try {
        const files = await fsp.readdir(logsDir);
        for (const file of files) {
            await fsp.unlink(join(logsDir, file));
        }
        log.dim(`  ✓ logs/ wiped (${files.length} files)`);
    } catch {
        // Logs dir might not exist or be empty
    }

    // Hard reset: wipe monitor.md and monitor identity from config
    if (options.hard) {
        const monitorPath = join(blockPath, 'monitor.md');
        try {
            await fsp.writeFile(monitorPath, FILE_TEMPLATES.MONITOR_MD(blockName), 'utf-8');
            log.dim('  ✓ monitor.md reset');
        } catch { /* ignore */ }

        // Clear monitor identity from config
        const configPath = join(blockPath, 'config.json');
        try {
            const raw = await fsp.readFile(configPath, 'utf-8');
            const config = JSON.parse(raw);
            delete config.monitorName;
            delete config.monitorEmoji;
            await fsp.writeFile(configPath, JSON.stringify(config, null, 4), 'utf-8');
            log.dim('  ✓ monitor identity cleared');
        } catch { /* ignore */ }
    } else {
        log.dim('  ℹ monitor.md and identity preserved (use --hard to wipe)');
    }

    console.log(`\n${chalk.green(`✓ ${blockName} reset.`)}`);
}