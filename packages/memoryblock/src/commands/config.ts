import { getConfigPath, getAuthPath, loadGlobalConfig, resolveBlockPath } from '@memoryblock/core';
import { pathExists } from '@memoryblock/core';
import { log } from '@memoryblock/core';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * `mblk config` — Quick config editing via your terminal editor.
 *
 * Usage:
 *   mblk config              → open global config
 *   mblk config auth         → open auth/credentials file
 *   mblk config <block>      → open block config
 *   mblk config --path       → just print the config file path (for scripting)
 */
export async function configCommand(
    target?: string,
    options?: { path?: boolean },
): Promise<void> {
    let filePath: string;
    let label: string;

    if (!target || target === 'global') {
        filePath = getConfigPath();
        label = 'global config';
    } else if (target === 'auth' || target === 'credentials') {
        filePath = getAuthPath();
        label = 'credentials';
    } else {
        // Treat as block name
        const globalConfig = await loadGlobalConfig();
        const blockPath = resolveBlockPath(globalConfig, target);
        const blockConfigPath = join(blockPath, 'config.json');

        if (!await pathExists(blockConfigPath)) {
            log.error(`Block "${target}" not found.`);
            log.dim(`  Available targets: global, auth, or a block name.`);
            process.exit(1);
        }

        filePath = blockConfigPath;
        label = `block "${target}" config`;
    }

    if (!existsSync(filePath)) {
        log.error(`Config file not found: ${filePath}`);
        log.dim(`  Run \`mblk init\` to set up your workspace first.`);
        process.exit(1);
    }

    // --path mode: just print the path (for scripting: `cat $(mblk config --path)`)
    if (options?.path) {
        console.log(filePath);
        return;
    }

    const editor = detectEditor();

    log.brand(`config — ${label}\n`);
    log.dim(`  File: ${filePath}`);
    log.dim(`  Editor: ${editor}\n`);

    // Open in editor
    try {
        const child = spawn(editor, [filePath], {
            stdio: 'inherit',
            shell: true,
        });

        await new Promise<void>((resolve, reject) => {
            child.on('exit', (code) => {
                if (code === 0) {
                    log.success(`  Config saved.`);
                    resolve();
                } else {
                    reject(new Error(`Editor exited with code ${code}`));
                }
            });
            child.on('error', reject);
        });
    } catch (err) {
        log.error(`Failed to open editor: ${(err as Error).message}`);
        log.dim(`  Set your preferred editor: export EDITOR=nano`);
        log.dim(`  Or edit manually: ${filePath}`);
    }
}

/**
 * Detect the best available terminal editor.
 * Priority: $EDITOR → $VISUAL → nano → vi → vim → notepad (Windows)
 */
function detectEditor(): string {
    // Respect user's preference
    if (process.env.EDITOR) return process.env.EDITOR;
    if (process.env.VISUAL) return process.env.VISUAL;

    const isWindows = platform() === 'win32';

    if (isWindows) {
        // Windows fallback chain
        const windowsEditors = ['code --wait', 'notepad'];
        for (const editor of windowsEditors) {
            const bin = editor.split(' ')[0];
            if (commandExists(bin)) return editor;
        }
        return 'notepad';
    }

    // Unix fallback chain (most minimal terminal editors first)
    const unixEditors = ['nano', 'vi', 'vim', 'nvim', 'micro', 'code --wait'];
    for (const editor of unixEditors) {
        const bin = editor.split(' ')[0];
        if (commandExists(bin)) return editor;
    }

    return 'vi'; // vi is available on virtually all Unix systems
}

function commandExists(cmd: string): boolean {
    try {
        const check = platform() === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
        execSync(check, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}
