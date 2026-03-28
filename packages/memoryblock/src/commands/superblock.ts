import { loadGlobalConfig, resolveBlockPath, loadBlockConfig, saveBlockConfig } from '@memoryblock/core';
import { pathExists } from '@memoryblock/core';
import { log } from '@memoryblock/core';
import { join } from 'node:path';

/**
 * `mblk superblock <block>` — Elevate a block to unrestricted system access.
 * `mblk superblock <block> --off` — Revoke superblock privileges.
 *
 * Superblock = scope: system + allowShell: true + allowNetwork: true
 * This is the "ops/admin" mode for blocks that need to manage infrastructure,
 * run commands, read system files, and operate without sandbox restrictions.
 */
export async function superblockCommand(
    blockName: string,
    options?: { off?: boolean },
): Promise<void> {
    const globalConfig = await loadGlobalConfig();
    const blockPath = resolveBlockPath(globalConfig, blockName);

    if (!await pathExists(join(blockPath, 'config.json'))) {
        log.error(`Block "${blockName}" not found.`);
        process.exit(1);
    }

    const config = await loadBlockConfig(blockPath);
    const perms = config.permissions || { scope: 'block', allowShell: false, allowNetwork: true, maxTimeout: 120_000 };

    if (options?.off) {
        // Revoke superblock — revert to safe defaults
        perms.scope = 'block';
        perms.allowShell = false;
        (config as any).permissions = perms;
        (config as any).tools = { ...(config as any).tools, sandbox: true };
        await saveBlockConfig(blockPath, config);

        log.brand(`${blockName}\n`);
        log.success(`  Superblock privileges revoked.`);
        log.dim(`  Scope: block, Shell: denied, Sandbox: on`);
        log.dim(`  Block is now running in restricted mode.\n`);
        return;
    }

    // Grant superblock — full system access
    perms.scope = 'system';
    perms.allowShell = true;
    perms.allowNetwork = true;
    (config as any).permissions = perms;
    (config as any).tools = { ...(config as any).tools, sandbox: false };
    await saveBlockConfig(blockPath, config);

    log.brand(`${blockName}\n`);
    log.success(`  ⚡ Superblock activated.`);
    log.dim(`  Scope: system, Shell: allowed, Sandbox: off`);
    log.dim(`  This block now has unrestricted access to the machine.`);
    log.dim(`  Revoke with: mblk superblock ${blockName} --off\n`);
}