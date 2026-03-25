import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT = 50_000;

// Commands that are safe to auto-execute without approval
const SAFE_PREFIXES = [
    'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'which', 'echo', 'pwd',
    'node --version', 'bun --version', 'pnpm --version', 'npm --version',
    'git status', 'git log', 'git diff', 'git branch',
    'tsc --noEmit', 'npx eslint', 'pnpm lint', 'npm run lint',
    'pnpm build', 'npm run build', 'pnpm test', 'npm test',
];

function isSafeCommand(command: string): boolean {
    const trimmed = command.trim();
    return SAFE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ===== execute_command =====
export const executeCommandTool: Tool = {
    definition: {
        name: 'execute_command',
        description: 'Run shell command (Safe cmds run auto).',
        parameters: createSchema(
            {
                command: { type: 'string', description: 'Command.' },
                timeout: { type: 'string', description: 'Timeout (ms).' },
            },
            ['command'],
        ),
        // Dynamic approval: overridden at dispatch time based on command safety
        requiresApproval: true,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const command = params.command as string;
        const scope = context.permissions?.scope || 'block';

        // Permission check: shell access must be explicitly granted
        if (!context.permissions?.allowShell && scope !== 'system') {
            return {
                content: `Shell access denied. Current permission scope: "${scope}". Set allowShell: true or scope: "system" via \`mblk permissions ${context.blockName} --allow-shell\`.`,
                isError: true,
            };
        }

        const timeout = context.permissions?.maxTimeout
            || (params.timeout ? parseInt(params.timeout as string, 10) : DEFAULT_TIMEOUT);

        // Determine cwd based on scope
        let cwd = context.workingDir || context.blockPath;
        if (scope === 'block') {
            cwd = context.blockPath;
        } else if (scope === 'workspace' && context.workspacePath) {
            // Allow commands within workspace, but default cwd to block
            cwd = context.workingDir || context.blockPath;
        }
        // scope === 'system' — use whatever workingDir is set

        try {
            const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], {
                cwd,
                timeout,
                maxBuffer: 2 * 1024 * 1024,
                env: { ...process.env, HOME: process.env.HOME },
            });

            let output = '';
            if (stdout) output += stdout;
            if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;

            if (output.length > MAX_OUTPUT) {
                output = output.slice(0, MAX_OUTPUT) + `\n...(truncated, ${output.length} total chars)`;
            }

            return { content: output || '(no output)', isError: false };
        } catch (err) {
            const error = err as Error & { stdout?: string; stderr?: string; code?: number };
            let message = error.message;
            if (error.stdout) message += `\nstdout: ${error.stdout.slice(0, 5000)}`;
            if (error.stderr) message += `\nstderr: ${error.stderr.slice(0, 5000)}`;
            return { content: `Command failed: ${message}`, isError: true };
        }
    },
};

/** Check if a command is safe (export for use in approval logic). */
export { isSafeCommand };

/** All built-in shell tools. */
export const shellTools: Tool[] = [executeCommandTool];