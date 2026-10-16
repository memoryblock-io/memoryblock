import { promises as fsp } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolExecutionResult, ToolContext } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

// Security: blocked paths
const BLOCKED_PATTERNS = ['.env', 'auth.json', '.memoryblock/auth.json'];

function isBlockedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return BLOCKED_PATTERNS.some((p) => normalized.endsWith(p) || normalized.includes(`/${p}`));
}

function resolvePath(context: ToolContext, targetPath: string): string {
    const base = context.workingDir || context.blockPath;
    const resolved = isAbsolute(targetPath) ? targetPath : resolve(base, targetPath);
    const scope = context.permissions?.scope || 'block';

    if (scope === 'system') {
        return resolved;
    }

    const allowedRoot = scope === 'workspace' && context.workspacePath
        ? context.workspacePath
        : context.blockPath;

    const rel = relative(allowedRoot, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
        const label = scope === 'workspace' ? 'workspace' : 'block directory';
        throw new Error(`Access denied: path "${targetPath}" is outside the ${label}. Current scope: ${scope}.`);
    }
    return resolved;
}

export interface PatchChunk {
    search: string;
    replace: string;
}

/**
 * Parses search/replace blocks in the format:
 * <<<<<<< SEARCH
 * old code
 * =======
 * new code
 * >>>>>>> REPLACE
 */
export function parseDiffBlocks(patchText: string): PatchChunk[] {
    const chunks: PatchChunk[] = [];
    const blockRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(patchText)) !== null) {
        chunks.push({
            search: match[1],
            replace: match[2],
        });
    }

    // Also support alternative separator markers if <<<<<<< not found
    if (chunks.length === 0 && patchText.includes('===') && patchText.includes('---')) {
        const altRegex = /--- SEARCH\r?\n([\s\S]*?)\r?\n\+\+\+ REPLACE\r?\n([\s\S]*?)\r?\n=== END/g;
        while ((match = altRegex.exec(patchText)) !== null) {
            chunks.push({
                search: match[1],
                replace: match[2],
            });
        }
    }

    return chunks;
}

/**
 * Normalize line endings to LF for consistent matching.
 */
function normalizeLf(str: string): string {
    return str.replace(/\r\n/g, '\n');
}

/**
 * Apply surgical patches to a string content.
 */
export function applyPatchChunks(original: string, chunks: PatchChunk[]): { content: string; appliedCount: number; errors: string[] } {
    let current = normalizeLf(original);
    let appliedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const searchNorm = normalizeLf(chunk.search);
        const replaceNorm = normalizeLf(chunk.replace);

        if (!searchNorm) {
            errors.push(`Chunk #${i + 1}: search block is empty.`);
            continue;
        }

        // 1. Exact match
        if (current.includes(searchNorm)) {
            current = current.replace(searchNorm, replaceNorm);
            appliedCount++;
            continue;
        }

        // 2. Whitespace-trimmed line match
        const currentLines = current.split('\n');
        const searchLines = searchNorm.split('\n');
        let matchIndex = -1;

        for (let j = 0; j <= currentLines.length - searchLines.length; j++) {
            let matches = true;
            for (let k = 0; k < searchLines.length; k++) {
                if (currentLines[j + k].trimEnd() !== searchLines[k].trimEnd()) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                matchIndex = j;
                break;
            }
        }

        if (matchIndex !== -1) {
            const before = currentLines.slice(0, matchIndex);
            const after = currentLines.slice(matchIndex + searchLines.length);
            const replaceLines = replaceNorm.split('\n');
            current = [...before, ...replaceLines, ...after].join('\n');
            appliedCount++;
        } else {
            const preview = searchNorm.split('\n').slice(0, 3).join('\n');
            errors.push(`Chunk #${i + 1} failed: search block not found in file:\n${preview}...`);
        }
    }

    return { content: current, appliedCount, errors };
}

// ===== apply_patch tool =====
export const applyPatchTool: Tool = {
    definition: {
        name: 'apply_patch',
        description: 'Surgically apply single or multi-chunk diff patches to a file without rewriting the whole file. Saves significant tokens. Accepts unified search/replace chunks or chunk blocks.',
        parameters: createSchema(
            {
                path: { type: 'string', description: 'Path to the target file.' },
                patch: { type: 'string', description: 'Patch content using `<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE` blocks.' },
                search: { type: 'string', description: 'Target block of lines to replace (if not using patch string).' },
                replace: { type: 'string', description: 'New replacement lines (if not using patch string).' },
            },
            ['path'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const targetPath = params.path as string;
        const filePath = resolvePath(context, targetPath);

        if (isBlockedPath(filePath)) {
            return { content: 'Access denied: this file is protected.', isError: true };
        }

        let chunks: PatchChunk[] = [];

        // Style 1: Direct search/replace params
        if (params.search && typeof params.replace === 'string') {
            chunks.push({
                search: params.search as string,
                replace: params.replace as string,
            });
        }

        // Style 2: Patch text blocks
        if (params.patch && typeof params.patch === 'string') {
            const parsed = parseDiffBlocks(params.patch);
            chunks = [...chunks, ...parsed];
        }

        // Style 3: Array of chunks passed dynamically
        if (Array.isArray(params.chunks)) {
            for (const c of params.chunks) {
                if (c && typeof c === 'object' && 'search' in c && 'replace' in c) {
                    chunks.push({
                        search: String(c.search),
                        replace: String(c.replace),
                    });
                }
            }
        }

        if (chunks.length === 0) {
            return {
                content: 'No patch chunks provided. Provide either `patch` with <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks or `search` and `replace` strings.',
                isError: true,
            };
        }

        try {
            const originalContent = await fsp.readFile(filePath, 'utf-8');
            const { content: updatedContent, appliedCount, errors } = applyPatchChunks(originalContent, chunks);

            if (appliedCount === 0 && errors.length > 0) {
                return {
                    content: `Failed to apply patch to ${targetPath}:\n${errors.join('\n')}`,
                    isError: true,
                };
            }

            await fsp.writeFile(filePath, updatedContent, 'utf-8');

            let message = `Successfully applied ${appliedCount} patch chunk(s) to ${targetPath}.`;
            if (errors.length > 0) {
                message += `\nWarnings / Skipped chunks:\n${errors.join('\n')}`;
            }

            return { content: message, isError: false };
        } catch (err) {
            return {
                content: `Failed to apply patch: ${(err as Error).message}`,
                isError: true,
            };
        }
    },
};
