import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { loadGlobalConfig, resolveBlocksDir, isInitialized } from '../../utils/config.js';
import { ensureDir, pathExists } from '../../utils/fs.js';
import { log } from '../logger.js';
import { t } from '@memoryblock/locale';

/**
 * Find archived folders matching a block name.
 * Supports both:
 *   - Exact archive name: "dev-pal_2026-03-21T10-33-24-242Z"
 *   - Block name prefix: "dev-pal" (matches all archives of that block)
 */
async function findArchives(archiveDir: string, query: string): Promise<string[]> {
    // Strip _archive/ prefix if user pastes it
    const name = query.replace(/^_archive\//, '');

    try {
        const entries = await fsp.readdir(archiveDir);

        // 1. Exact match
        if (entries.includes(name)) return [name];

        // 2. Prefix match: "dev-pal" matches "dev-pal_2026-03-21T10-33-24-242Z"
        const matches = entries
            .filter(e => e.startsWith(`${name}_`))
            .sort()
            .reverse(); // newest first

        return matches;
    } catch {
        return [];
    }
}

/**
 * Resolve a single archive — if multiple exist, let user pick.
 */
async function resolveArchive(archiveDir: string, query: string): Promise<string | null> {
    const matches = await findArchives(archiveDir, query);

    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    // Multiple archives — let the user pick
    const selection = await p.select({
        message: `Multiple archives found for "${query}". Which one?`,
        options: matches.map(m => {
            // Extract the timestamp for a cleaner label
            const tsMatch = m.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
            const hint = tsMatch ? tsMatch[1].replace(/-/g, ':').replace('T', ' ').slice(0, 16) : '';
            return { value: m, label: m, hint };
        }),
    });

    if (p.isCancel(selection)) return null;
    return selection as string;
}

export async function deleteCommand(blockName: string, options?: { hard?: boolean }): Promise<void> {
    if (!(await isInitialized())) {
        throw new Error(t.general.notInitialized);
    }

    const globalConfig = await loadGlobalConfig();
    const blocksDir = resolveBlocksDir(globalConfig);
    const blockPath = join(blocksDir, blockName);

    // Check if it's a direct block path first
    if (await pathExists(blockPath)) {
        if (blockName.startsWith('_archive/')) {
            if (!options?.hard) {
                throw new Error(t.archive.mustUseHard);
            }
        }

        if (options?.hard) {
            try {
                await fsp.rm(blockPath, { recursive: true, force: true });
                log.success(t.archive.hardDeleteSuccess(blockName));
            } catch (err) {
                throw new Error(`Failed to delete: ${(err as Error).message}`);
            }
            return;
        }

        // Soft delete — move to _archive directory
        const archiveDir = join(blocksDir, '_archive');
        await ensureDir(archiveDir);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveName = `${blockName}_${timestamp}`;
        const archivePath = join(archiveDir, archiveName);

        try {
            await fsp.rename(blockPath, archivePath);
            log.success(t.archive.success(blockName));
            log.dim(`  ${t.archive.location(`_archive/${archiveName}`)}`);
            log.dim(`  ${t.archive.restoreCmd(blockName)}`);
            log.dim(`  ${t.archive.deleteCmd(blockName)}`);
        } catch (err) {
            throw new Error(`Failed to archive block: ${(err as Error).message}`);
        }
        return;
    }

    // Not a live block — maybe user wants to hard-delete an archive by name?
    if (options?.hard) {
        const archiveDir = join(blocksDir, '_archive');
        const resolved = await resolveArchive(archiveDir, blockName);

        if (!resolved) {
            throw new Error(`Block or archive "${blockName}" not found.`);
        }

        const archivePath = join(archiveDir, resolved);
        try {
            await fsp.rm(archivePath, { recursive: true, force: true });
            log.success(`"${resolved}" permanently deleted from archive.`);
        } catch (err) {
            throw new Error(`Failed to delete: ${(err as Error).message}`);
        }
        return;
    }

    throw new Error(`Block "${blockName}" not found. Run \`mblk status\` to see available blocks.`);
}

export async function restoreCommand(archiveName: string): Promise<void> {
    if (!(await isInitialized())) {
        throw new Error(t.general.notInitialized);
    }

    const globalConfig = await loadGlobalConfig();
    const blocksDir = resolveBlocksDir(globalConfig);
    const archiveDir = join(blocksDir, '_archive');

    // Resolve the archive — supports block name, full name, or prefix
    const resolved = await resolveArchive(archiveDir, archiveName);

    if (!resolved) {
        throw new Error(`No archive found for "${archiveName}". Run \`mblk status\` to check archives.`);
    }

    const archivePath = join(archiveDir, resolved);

    // Extract original block name (strip timestamp suffix)
    const match = resolved.match(/^(.*?)_\d{4}-\d{2}-\d{2}T.*/);
    const targetName = match ? match[1] : resolved;
    const targetPath = join(blocksDir, targetName);

    if (await pathExists(targetPath)) {
        throw new Error(`Cannot restore: A block named "${targetName}" already exists. Delete or rename it first.`);
    }

    try {
        await fsp.rename(archivePath, targetPath);
        log.success(`Block "${targetName}" restored successfully.`);
        log.dim(`  Start with: ${chalk.bold(`mblk start ${targetName}`)}`);
    } catch (err) {
        throw new Error(`Failed to restore block: ${(err as Error).message}`);
    }
}
