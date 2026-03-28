#!/usr/bin/env node

/**
 * memoryblock CLI — Main Entry Point
 *
 * Runs on Bun (primary, faster) or Node.js ≥20 (fallback).
 * Loaded by bin/mblk.js after runtime detection.
 */

// Silence ALL Node.js native warnings (DeprecationWarning, ExperimentalWarning, etc.)
// These are irrelevant to end-users and completely break the TUI/console animations.
process.removeAllListeners('warning');

import { Command } from 'commander';
import { log } from '@memoryblock/core';
import { getVersion, DEFAULT_PORT } from './constants.js';

import { initCommand } from './commands/init.js';
import { createCommand } from './commands/create.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { resetCommand } from './commands/reset.js';
import {
    serverStartCommand, serverStopCommand, serverStatusCommand,
    serverTokenCommand, shutdownCommand, restartCommand,
} from './commands/server.js';
import { addCommand, removeCommand } from './commands/plugins.js';
import { deleteCommand, restoreCommand } from './commands/delete.js';
import { permissionsCommand } from './commands/permissions.js';
import { pluginSettingsCommand } from './commands/plugin-settings.js';
import { serviceInstallCommand, serviceUninstallCommand, serviceStatusCommand } from './commands/service.js';
import { superblockCommand } from './commands/superblock.js';
import { configCommand } from './commands/config.js';
import { checkForUpdate } from './utils/version-check.js';

(async () => {

const version = await getVersion();
const program = new Command();

program
    .name('mblk')
    .description('Deploy isolated, multi-agent AI assistants with extreme resource efficiency.')
    .version(version)
    .exitOverride(() => process.exit(0))
    .configureOutput({
        writeOut: (str) => process.stdout.write(str),
        writeErr: (str) => process.stdout.write(str),
    });

program
    .command('init')
    .description('Interactive setup — configure credentials, verify connections, create your first block.')
    .option('-y, --yes', 'Non-interactive mode: create defaults without prompts')
    .action(async (opts: { yes?: boolean }) => {
        try {
            await initCommand({ nonInteractive: opts.yes });
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('create <name>')
    .description('Create a new block (isolated AI workspace).')
    .action(async (name: string) => {
        try {
            await createCommand(name);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('start [block]')
    .description('Start the monitor loop for a block (or all blocks).')
    .option('-d, --daemon', 'Run the monitor in the background')
    .option('-c, --channel <channel>', 'Specify override channel (e.g. web, cli)')
    .action(async (block: string | undefined, opts: { daemon?: boolean; channel?: string }) => {
        try {
            await startCommand(block, opts);
        } catch (err) {
            const msg = (err as Error).message;
            // If not initialized, auto-route to init and then retry
            if (msg.includes('not initialized') || msg.includes('mblk init')) {
                log.warn('Workspace not initialized. Running setup first...\n');
                try {
                    await initCommand();
                    // Retry start after init completes
                    await startCommand(block, opts);
                } catch (initErr) {
                    log.error((initErr as Error).message);
                    process.exit(0);
                }
                return;
            }
            log.error(msg);
            process.exit(0);
        }
    });

program
    .command('stop [block]')
    .description('Stop a running block monitor (or all blocks).')
    .action(async (block?: string) => {
        try {
            await stopCommand(block);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('status')
    .description('Show the status of all blocks.')
    .action(async () => {
        try {
            await statusCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('reset <block>')
    .description('Reset a block state (memory, pulse, costs). Use --hard to wipe logs.')
    .option('--hard', 'Wipe logs directory as well')
    .action(async (block: string, opts: { hard?: boolean }) => {
        try {
            await resetCommand(block, opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });


program
    .command('delete <block>')
    .description('Archive a block to prevent data loss. Use --hard to permanently delete.')
    .option('--hard', 'Permanently wipe the block from disk')
    .action(async (block: string, opts: { hard?: boolean }) => {
        try {
            await deleteCommand(block, opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('restore <name>')
    .description('Restore an archived block by name.')
    .action(async (archive: string) => {
        try {
            await restoreCommand(archive);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });
program
    .command('permissions <block>')
    .description('View or update block permissions (CLI-only).')
    .option('-s, --scope <level>', 'Set scope: block, workspace, or system')
    .option('--allow-shell', 'Allow shell command execution')
    .option('--deny-shell', 'Deny shell command execution')
    .option('--allow-network', 'Allow network/fetch access')
    .option('--deny-network', 'Deny network/fetch access')
    .option('--max-timeout <seconds>', 'Max command timeout in seconds')
    .action(async (block: string, opts: any) => {
        try {
            await permissionsCommand(block, opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });
program
    .command('settings [plugin]')
    .description('View or edit plugin settings.')
    .action(async (pluginId?: string) => {
        try {
            await pluginSettingsCommand(pluginId);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

// ===== Server Subcommand Group =====

const server = program
    .command('server')
    .description('Manage the web/API server.');

server
    .command('start')
    .description('Start the web UI and API server.')
    .option('-p, --port <port>', 'Port to listen on', DEFAULT_PORT)
    .option('--new-token', 'Generate a new auth token')
    .option('-d, --daemon', 'Run the server in the background')
    .action(async (opts: { port?: string; newToken?: boolean; daemon?: boolean }) => {
        try {
            await serverStartCommand(opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

server
    .command('stop')
    .description('Stop the running server.')
    .action(async () => {
        try {
            await serverStopCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

server
    .command('status')
    .description('Show server status (PID, port, running state).')
    .action(async () => {
        try {
            await serverStatusCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

server
    .command('token')
    .description('View the current API token, or generate a new one.')
    .option('--new-token', 'Generate and set a new API token')
    .action(async (opts: { newToken?: boolean }) => {
        try {
            await serverTokenCommand(opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

// ===== Service Subcommand Group =====

const service = program
    .command('service')
    .description('Manage OS-level auto-start (launchd/systemd).');

service
    .command('install')
    .description('Register memoryblock to start on boot/login.')
    .action(async () => {
        try {
            await serviceInstallCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

service
    .command('uninstall')
    .description('Remove memoryblock from system auto-start.')
    .action(async () => {
        try {
            await serviceUninstallCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

service
    .command('status')
    .description('Check if the auto-start service is installed.')
    .action(async () => {
        try {
            await serviceStatusCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

// ===== Lifecycle Commands =====

program
    .command('shutdown')
    .description('Stop all blocks and the server.')
    .action(async () => {
        try {
            await shutdownCommand();
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('restart')
    .description('Restart: stop everything, then start server as daemon.')
    .option('-p, --port <port>', 'Port to listen on', DEFAULT_PORT)
    .action(async (opts: { port?: string }) => {
        try {
            await restartCommand(opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

// Backward-compatible alias: `mblk web` = `mblk server start`
program
    .command('web')
    .description('Alias for `mblk server start`.')
    .option('-p, --port <port>', 'Port to listen on', DEFAULT_PORT)
    .option('--new-token', 'Generate a new auth token')
    .option('-d, --daemon', 'Run the server in the background')
    .action(async (opts: { port?: string; newToken?: boolean; daemon?: boolean }) => {
        try {
            await serverStartCommand(opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('add [plugin]')
    .description('Install a plugin (run without args to list available plugins).')
    .action(async (plugin: string) => {
        try {
            await addCommand(plugin);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('remove <plugin>')
    .description('Remove an installed plugin.')
    .action(async (plugin: string) => {
        try {
            await removeCommand(plugin);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('superblock <block>')
    .description('Grant a block full system access (shell, files, unrestricted).')
    .option('--off', 'Revoke superblock privileges and restore sandbox')
    .action(async (block: string, opts: { off?: boolean }) => {
        try {
            await superblockCommand(block, opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('config [target]')
    .description('Open config file in your editor (global, auth, or <block-name>).')
    .option('--path', 'Print the file path instead of opening editor')
    .action(async (target: string | undefined, opts: { path?: boolean }) => {
        try {
            await configCommand(target, opts);
        } catch (err) {
            log.error((err as Error).message);
            process.exit(0);
        }
    });

program
    .command('update')
    .description('Update memoryblock to the latest version and restart all services.')
    .action(async () => {
        const chalk = (await import('chalk')).default;
        const { execSync } = await import('node:child_process');
        const { checkForUpdate } = await import('./utils/version-check.js');

        try {
            // 1. Check if update is actually available
            console.log('');
            console.log(chalk.hex('#7C3AED')('  ⬡ memoryblock'), ' update\n');
            console.log(chalk.dim('  Checking for updates...'));

            const result = await checkForUpdate(version, true);
            if (!result?.updateAvailable) {
                console.log(chalk.green('  ✓'), `  Already on the latest version (${version}).`);
                console.log('');
                return;
            }

            console.log(`  Update available: ${chalk.dim(result.current)} → ${chalk.green(result.latest)}\n`);

            // 2. Install the new version
            console.log(chalk.dim('  Installing...'));
            execSync('npm install -g memoryblock 2>&1', {
                timeout: 120_000,
                stdio: 'inherit',
            });
            console.log(chalk.green('  ✓'), '  Package updated.\n');

            // 3. Graceful shutdown (blocks save memory/session/costs via SIGTERM)
            console.log(chalk.dim('  Restarting services...'));
            try {
                await shutdownCommand();
            } catch { /* may already be stopped */ }

            // 4. Wait for processes to exit cleanly
            await new Promise(r => setTimeout(r, 3000));

            // 5. Restart everything with the new code
            try {
                await restartCommand({ port: DEFAULT_PORT });
            } catch { /* restart command outputs its own messages */ }

            console.log('');
            console.log(chalk.green('  ✓'), `  memoryblock updated to ${chalk.bold(result.latest)}`);
            console.log(chalk.dim('      All services restarted with new code.\n'));
        } catch (err) {
            log.error(`Update failed: ${(err as Error).message}`);
            process.exit(1);
        }
    });

program.parse();

// Non-blocking version check — runs after command completes
if (process.stdout.isTTY && !process.argv.includes('--version')) {
    checkForUpdate(version).then(result => {
        if (result?.updateAvailable) {
            console.log(`\n  \x1b[33m⬡\x1b[0m Update available: \x1b[2m${result.current}\x1b[0m → \x1b[32m${result.latest}\x1b[0m`);
            console.log(`    Run \x1b[36mmblk update\x1b[0m to update\n`);
        }
    }).catch(() => {});
}

})();