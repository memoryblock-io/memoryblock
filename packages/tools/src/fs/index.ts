import { promises as fsp } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolExecutionResult, ToolContext } from 'memoryblock';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

const execFileAsync = promisify(execFile);

// Security: files that must never be read
const BLOCKED_PATTERNS = ['.env', 'auth.json', '.memoryblock/auth.json'];

function isBlockedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return BLOCKED_PATTERNS.some((p) => normalized.endsWith(p) || normalized.includes(`/${p}`));
}

/** Resolve a path. Scope is determined by block permissions. */
function resolvePath(context: ToolContext, targetPath: string): string {
    const base = context.workingDir || context.blockPath;
    const resolved = isAbsolute(targetPath) ? targetPath : resolve(base, targetPath);
    const scope = context.permissions?.scope || 'block';

    if (scope === 'system') {
        // Unrestricted — still block sensitive files
        return resolved;
    }

    // Determine allowed root based on scope
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

// ===== read_file =====
export const readFileTool: Tool = {
    definition: {
        name: 'read_file',
        description: 'Read the contents of a file.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Path to the file.' } },
            ['path'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const filePath = resolvePath(context, params.path as string);
        if (isBlockedPath(filePath)) {
            return { content: 'Access denied: this file is protected.', isError: true };
        }
        try {
            const content = await fsp.readFile(filePath, 'utf-8');
            // Truncate extremely large files to save tokens
            if (content.length > 100_000) {
                return {
                    content: content.slice(0, 100_000) + `\n...(truncated, ${content.length} total chars. Use search_files to find specific content.)`,
                    isError: false,
                };
            }
            return { content, isError: false };
        } catch (err) {
            return { content: `Failed to read file: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== write_file =====
export const writeFileTool: Tool = {
    definition: {
        name: 'write_file',
        description: 'Write content to a file. Creates parent directories if needed.',
        parameters: createSchema(
            {
                path: { type: 'string', description: 'Path to the file.' },
                content: { type: 'string', description: 'Content to write.' },
            },
            ['path', 'content'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const filePath = resolvePath(context, params.path as string);
        if (isBlockedPath(filePath)) {
            return { content: 'Access denied: this file is protected.', isError: true };
        }
        try {
            await fsp.mkdir(join(filePath, '..'), { recursive: true });
            await fsp.writeFile(filePath, params.content as string, 'utf-8');
            return { content: `Written: ${params.path}`, isError: false };
        } catch (err) {
            return { content: `Failed to write: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== list_directory =====
export const listDirectoryTool: Tool = {
    definition: {
        name: 'list_directory',
        description: 'List files and directories in a path.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Path to list. Defaults to workspace root.' } },
            [],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const dirPath = resolvePath(context, (params.path as string) || '.');
        try {
            const entries = await fsp.readdir(dirPath, { withFileTypes: true });
            const listing = entries
                .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
                .join('\n');
            return { content: listing || '(empty directory)', isError: false };
        } catch (err) {
            return { content: `Failed to list: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== create_directory =====
export const createDirectoryTool: Tool = {
    definition: {
        name: 'create_directory',
        description: 'Create a directory.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Path of the directory to create.' } },
            ['path'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const dirPath = resolvePath(context, params.path as string);
        try {
            await fsp.mkdir(dirPath, { recursive: true });
            return { content: `Created: ${params.path}`, isError: false };
        } catch (err) {
            return { content: `Failed to create: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== search_files =====
export const searchFilesTool: Tool = {
    definition: {
        name: 'search_files',
        description: 'Search for text in files using grep. Returns matching lines with file paths and line numbers.',
        parameters: createSchema(
            {
                query: { type: 'string', description: 'Text to search for.' },
                path: { type: 'string', description: 'Directory to search in. Defaults to workspace root.' },
                include: { type: 'string', description: 'File glob pattern to include, e.g. "*.ts".' },
            },
            ['query'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const searchDir = resolvePath(context, (params.path as string) || '.');
        const query = params.query as string;
        const include = params.include as string | undefined;

        try {
            const args = ['-rnI', '--color=never', '-m', '50'];
            if (include) args.push('--include', include);
            args.push(query, searchDir);

            const { stdout } = await execFileAsync('grep', args, {
                timeout: 15_000,
                maxBuffer: 512 * 1024,
            });
            const output = stdout.trim();
            if (!output) return { content: 'No matches found.', isError: false };
            // Truncate if too many results
            if (output.length > 20_000) {
                return { content: output.slice(0, 20_000) + '\n...(truncated)', isError: false };
            }
            return { content: output, isError: false };
        } catch (err) {
            const e = err as Error & { code?: number; stdout?: string };
            if (e.code === 1) return { content: 'No matches found.', isError: false };
            return { content: `Search failed: ${e.message}`, isError: true };
        }
    },
};

// ===== replace_in_file =====
export const replaceInFileTool: Tool = {
    definition: {
        name: 'replace_in_file',
        description: 'Find and replace text in a file.',
        parameters: createSchema(
            {
                path: { type: 'string', description: 'File path.' },
                find: { type: 'string', description: 'Text to find.' },
                replace: { type: 'string', description: 'Replacement text.' },
                all: { type: 'string', description: 'Replace all? "true"/"false".' },
            },
            ['path', 'find', 'replace'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const filePath = resolvePath(context, params.path as string);
        if (isBlockedPath(filePath)) {
            return { content: 'Access denied: this file is protected.', isError: true };
        }
        try {
            const content = await fsp.readFile(filePath, 'utf-8');
            const find = params.find as string;
            const replace = params.replace as string;
            const replaceAll = (params.all as string) === 'true';

            if (!content.includes(find)) {
                return { content: `Text not found in ${params.path}. Check exact whitespace/formatting.`, isError: true };
            }

            const updated = replaceAll
                ? content.split(find).join(replace)
                : content.replace(find, replace);

            await fsp.writeFile(filePath, updated, 'utf-8');
            const count = replaceAll ? content.split(find).length - 1 : 1;
            return { content: `Replaced ${count} occurrence(s) in ${params.path}`, isError: false };
        } catch (err) {
            return { content: `Failed: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== file_info =====
export const fileInfoTool: Tool = {
    definition: {
        name: 'file_info',
        description: 'Get file metadata: size, modified date, type.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Path to the file or directory.' } },
            ['path'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const filePath = resolvePath(context, params.path as string);
        try {
            const stat = await fsp.stat(filePath);
            const info = [
                `Path: ${params.path}`,
                `Type: ${stat.isDirectory() ? 'directory' : 'file'}`,
                `Size: ${stat.size} bytes (${(stat.size / 1024).toFixed(1)} KB)`,
                `Modified: ${stat.mtime.toISOString()}`,
                `Created: ${stat.birthtime.toISOString()}`,
            ].join('\n');
            return { content: info, isError: false };
        } catch (err) {
            return { content: `Failed: ${(err as Error).message}`, isError: true };
        }
    },
};

/** All built-in FS tools. */
export const fsTools: Tool[] = [
    readFileTool, writeFileTool, listDirectoryTool, createDirectoryTool,
    searchFilesTool, replaceInFileTool, fileInfoTool,
];
