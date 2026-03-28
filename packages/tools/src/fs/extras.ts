import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

// ===== delete_file =====
export const deleteFileTool: Tool = {
    definition: {
        name: 'delete_file',
        description: 'Delete a file or empty directory.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Path to the file or directory to delete.' } },
            ['path'],
        ),
        requiresApproval: true,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const { resolve, isAbsolute, relative } = await import('node:path');
        const targetPath = params.path as string;
        const base = context.workingDir || context.blockPath;
        const resolved = isAbsolute(targetPath) ? targetPath : resolve(base, targetPath);

        // Block-scope check
        const scope = context.permissions?.scope || 'block';
        if (scope !== 'system') {
            const allowedRoot = scope === 'workspace' && context.workspacePath
                ? context.workspacePath : context.blockPath;
            const rel = relative(allowedRoot, resolved);
            if (rel.startsWith('..') || isAbsolute(rel)) {
                return { content: `Access denied: path outside ${scope} scope.`, isError: true };
            }
        }

        try {
            const stat = await fsp.stat(resolved);
            if (stat.isDirectory()) {
                await fsp.rmdir(resolved); // Only empty dirs
            } else {
                await fsp.unlink(resolved);
            }
            return { content: `Deleted: ${targetPath}`, isError: false };
        } catch (err) {
            return { content: `Failed to delete: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== move_file =====
export const moveFileTool: Tool = {
    definition: {
        name: 'move_file',
        description: 'Move or rename a file.',
        parameters: createSchema(
            {
                source: { type: 'string', description: 'Current path.' },
                destination: { type: 'string', description: 'New path.' },
            },
            ['source', 'destination'],
        ),
        requiresApproval: true,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const { resolve, isAbsolute, relative } = await import('node:path');
        const base = context.workingDir || context.blockPath;
        const src = isAbsolute(params.source as string) ? params.source as string : resolve(base, params.source as string);
        const dst = isAbsolute(params.destination as string) ? params.destination as string : resolve(base, params.destination as string);

        const scope = context.permissions?.scope || 'block';
        if (scope !== 'system') {
            const root = scope === 'workspace' && context.workspacePath ? context.workspacePath : context.blockPath;
            for (const p of [src, dst]) {
                const rel = relative(root, p);
                if (rel.startsWith('..') || isAbsolute(rel)) {
                    return { content: `Access denied: path outside ${scope} scope.`, isError: true };
                }
            }
        }

        try {
            await fsp.rename(src, dst);
            return { content: `Moved: ${params.source} → ${params.destination}`, isError: false };
        } catch (err) {
            return { content: `Failed to move: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== copy_file =====
export const copyFileTool: Tool = {
    definition: {
        name: 'copy_file',
        description: 'Copy a file to a new location.',
        parameters: createSchema(
            {
                source: { type: 'string', description: 'Source file path.' },
                destination: { type: 'string', description: 'Destination file path.' },
            },
            ['source', 'destination'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const { resolve, isAbsolute, relative } = await import('node:path');
        const base = context.workingDir || context.blockPath;
        const src = isAbsolute(params.source as string) ? params.source as string : resolve(base, params.source as string);
        const dst = isAbsolute(params.destination as string) ? params.destination as string : resolve(base, params.destination as string);

        const scope = context.permissions?.scope || 'block';
        if (scope !== 'system') {
            const root = scope === 'workspace' && context.workspacePath ? context.workspacePath : context.blockPath;
            for (const p of [src, dst]) {
                const rel = relative(root, p);
                if (rel.startsWith('..') || isAbsolute(rel)) {
                    return { content: `Access denied: path outside ${scope} scope.`, isError: true };
                }
            }
        }

        try {
            await fsp.mkdir(join(dst, '..'), { recursive: true });
            await fsp.copyFile(src, dst);
            return { content: `Copied: ${params.source} → ${params.destination}`, isError: false };
        } catch (err) {
            return { content: `Failed to copy: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== append_to_file =====
export const appendToFileTool: Tool = {
    definition: {
        name: 'append_to_file',
        description: 'Append content to the end of a file. Creates the file if it does not exist.',
        parameters: createSchema(
            {
                path: { type: 'string', description: 'File path.' },
                content: { type: 'string', description: 'Content to append.' },
            },
            ['path', 'content'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const { resolve, isAbsolute, relative } = await import('node:path');
        const base = context.workingDir || context.blockPath;
        const filePath = isAbsolute(params.path as string) ? params.path as string : resolve(base, params.path as string);

        const scope = context.permissions?.scope || 'block';
        if (scope !== 'system') {
            const root = scope === 'workspace' && context.workspacePath ? context.workspacePath : context.blockPath;
            const rel = relative(root, filePath);
            if (rel.startsWith('..') || isAbsolute(rel)) {
                return { content: `Access denied: path outside ${scope} scope.`, isError: true };
            }
        }

        try {
            await fsp.mkdir(join(filePath, '..'), { recursive: true });
            await fsp.appendFile(filePath, params.content as string, 'utf-8');
            return { content: `Appended to: ${params.path}`, isError: false };
        } catch (err) {
            return { content: `Failed to append: ${(err as Error).message}`, isError: true };
        }
    },
};
// ===== find_files =====
export const findFilesTool: Tool = {
    definition: {
        name: 'find_files',
        description: 'Recursively search for files by name pattern (glob-like). Returns matching file paths. Like `find . -name "*.ts"`.',
        parameters: createSchema(
            {
                pattern: { type: 'string', description: 'Filename pattern to match (e.g. "*.ts", "config*", "README.md").' },
                path: { type: 'string', description: 'Directory to search in. Defaults to working directory.' },
                maxDepth: { type: 'string', description: 'Maximum recursion depth. Default: 8.' },
            },
            ['pattern'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const { resolve, isAbsolute, relative } = await import('node:path');
        const base = context.workingDir || context.blockPath;
        const searchDir = isAbsolute(params.path as string || '') ? params.path as string : resolve(base, (params.path as string) || '.');
        const maxDepth = parseInt(params.maxDepth as string || '8', 10);

        const scope = context.permissions?.scope || 'block';
        if (scope !== 'system') {
            const root = scope === 'workspace' && context.workspacePath ? context.workspacePath : context.blockPath;
            const rel = relative(root, searchDir);
            if (rel.startsWith('..') || isAbsolute(rel)) {
                return { content: `Access denied: path outside ${scope} scope.`, isError: true };
            }
        }

        const pattern = params.pattern as string;
        // Convert glob pattern to regex: * → .*, ? → .
        const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
        const regex = new RegExp(regexStr, 'i');

        const results: string[] = [];
        const MAX_RESULTS = 100;

        async function walk(dir: string, depth: number): Promise<void> {
            if (depth > maxDepth || results.length >= MAX_RESULTS) return;
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (results.length >= MAX_RESULTS) break;
                    // Skip hidden dirs and node_modules
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

                    const fullPath = join(dir, entry.name);
                    if (regex.test(entry.name)) {
                        const rel = relative(searchDir, fullPath);
                        results.push(entry.isDirectory() ? `📁 ${rel}` : `📄 ${rel}`);
                    }
                    if (entry.isDirectory()) {
                        await walk(fullPath, depth + 1);
                    }
                }
            } catch { /* permission denied or unreadable */ }
        }

        try {
            await walk(searchDir, 0);
            if (results.length === 0) return { content: `No files matching "${pattern}" found.`, isError: false };
            let output = results.join('\n');
            if (results.length >= MAX_RESULTS) {
                output += `\n...(capped at ${MAX_RESULTS} results)`;
            }
            return { content: output, isError: false };
        } catch (err) {
            return { content: `Search failed: ${(err as Error).message}`, isError: true };
        }
    },
};

export const extraFsTools: Tool[] = [deleteFileTool, moveFileTool, copyFileTool, appendToFileTool, findFilesTool];