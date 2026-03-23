import { loadGlobalConfig, resolveBlockPath, loadBlockConfig, saveBlockConfig } from '../../utils/config.js';
import { pathExists } from '../../utils/fs.js';
import { log } from '../logger.js';
import { join } from 'node:path';

type PermissionScope = 'block' | 'workspace' | 'system';

const VALID_SCOPES: PermissionScope[] = ['block', 'workspace', 'system'];

/**
 * View or update block permissions.
 * Permissions are CLI-only — they cannot be changed via chat or web.
 */
export async function permissionsCommand(
    blockName: string,
    options?: {
        scope?: string;
        allowShell?: boolean;
        denyShell?: boolean;
        allowNetwork?: boolean;
        denyNetwork?: boolean;
        maxTimeout?: string;
    },
): Promise<void> {
    const globalConfig = await loadGlobalConfig();
    const blockPath = resolveBlockPath(globalConfig, blockName);

    if (!await pathExists(join(blockPath, 'config.json'))) {
        log.error(`Block "${blockName}" not found.`);
        process.exit(1);
    }

    const config = await loadBlockConfig(blockPath);
    const perms = config.permissions || { scope: 'block', allowShell: false, allowNetwork: true, maxTimeout: 120_000 };

    // No flags = show current permissions
    const hasFlags = options?.scope || options?.allowShell || options?.denyShell
        || options?.allowNetwork || options?.denyNetwork || options?.maxTimeout;

    if (!hasFlags) {
        log.brand(`permissions — ${blockName}\n`);
        console.log(`  Scope:          ${perms.scope}`);
        console.log(`  Shell Access:   ${perms.allowShell ? '✓ allowed' : '✗ denied'}`);
        console.log(`  Network:        ${perms.allowNetwork ? '✓ allowed' : '✗ denied'}`);
        console.log(`  Max Timeout:    ${(perms.maxTimeout / 1000).toFixed(0)}s`);
        console.log('');

        log.dim('  Scopes:');
        log.dim('    block     — read/write own block directory only (default)');
        log.dim('    workspace — access the entire workspace');
        log.dim('    system    — unrestricted file and shell access');
        console.log('');
        return;
    }

    // Apply changes
    if (options?.scope) {
        if (!VALID_SCOPES.includes(options.scope as PermissionScope)) {
            log.error(`Invalid scope: "${options.scope}". Use: block, workspace, or system.`);
            process.exit(1);
        }
        perms.scope = options.scope as PermissionScope;
    }

    if (options?.allowShell) perms.allowShell = true;
    if (options?.denyShell) perms.allowShell = false;
    if (options?.allowNetwork) perms.allowNetwork = true;
    if (options?.denyNetwork) perms.allowNetwork = false;
    if (options?.maxTimeout) perms.maxTimeout = parseInt(options.maxTimeout, 10) * 1000;

    // Save
    (config as any).permissions = perms;
    await saveBlockConfig(blockPath, config);

    log.success(`  Permissions updated for "${blockName}".`);
    console.log(`  Scope: ${perms.scope}, Shell: ${perms.allowShell ? 'yes' : 'no'}, Network: ${perms.allowNetwork ? 'yes' : 'no'}, Timeout: ${(perms.maxTimeout / 1000).toFixed(0)}s`);
}
