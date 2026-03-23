import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutionResult } from 'memoryblock';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

const execFileAsync = promisify(execFile);
const DEV_TIMEOUT = 120_000; // 2 minutes for builds
const MAX_OUTPUT = 50_000;

/** Find the project root by looking for package.json. */
async function findProjectRoot(startDir: string): Promise<string> {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
        try {
            await fsp.access(join(dir, 'package.json'));
            return dir;
        } catch {
            const parent = join(dir, '..');
            if (parent === dir) break;
            dir = parent;
        }
    }
    return startDir;
}

function truncateOutput(output: string): string {
    if (output.length > MAX_OUTPUT) {
        return output.slice(0, MAX_OUTPUT) + `\n...(truncated, ${output.length} total chars)`;
    }
    return output;
}

async function runCommand(command: string, cwd: string): Promise<ToolExecutionResult> {
    try {
        const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], {
            cwd,
            timeout: DEV_TIMEOUT,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, HOME: process.env.HOME, FORCE_COLOR: '0' },
        });
        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
        return { content: truncateOutput(output || '(no output)'), isError: false };
    } catch (err) {
        const e = err as Error & { stdout?: string; stderr?: string };
        let msg = e.message;
        if (e.stdout) msg += '\n' + e.stdout.slice(0, 10_000);
        if (e.stderr) msg += '\n' + e.stderr.slice(0, 10_000);
        return { content: truncateOutput(`Command failed: ${msg}`), isError: true };
    }
}

// ===== run_lint =====
export const runLintTool: Tool = {
    definition: {
        name: 'run_lint',
        description: 'Run ESLint.',
        parameters: createSchema(
            { path: { type: 'string', description: 'Target path.' } },
            [],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const projectRoot = await findProjectRoot(context.workingDir || context.blockPath);
        const target = (params.path as string) || '.';
        return runCommand(`npx eslint ${target} --no-color 2>&1 || true`, projectRoot);
    },
};

// ===== run_build =====
export const runBuildTool: Tool = {
    definition: {
        name: 'run_build',
        description: 'Run build command.',
        parameters: createSchema({}, []),
        requiresApproval: false,
    },
    async execute(_params, context): Promise<ToolExecutionResult> {
        const projectRoot = await findProjectRoot(context.workingDir || context.blockPath);
        // Try pnpm first, fall back to npm
        try {
            await fsp.access(join(projectRoot, 'pnpm-workspace.yaml'));
            return runCommand('pnpm run build 2>&1', projectRoot);
        } catch {
            return runCommand('npm run build 2>&1', projectRoot);
        }
    },
};

// ===== run_test =====
export const runTestTool: Tool = {
    definition: {
        name: 'run_test',
        description: 'Run tests.',
        parameters: createSchema(
            { filter: { type: 'string', description: 'Test filter.' } },
            [],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const projectRoot = await findProjectRoot(context.workingDir || context.blockPath);
        const filter = (params.filter as string) || '';
        try {
            await fsp.access(join(projectRoot, 'pnpm-workspace.yaml'));
            return runCommand(`pnpm test ${filter} 2>&1 || true`, projectRoot);
        } catch {
            return runCommand(`npm test ${filter} 2>&1 || true`, projectRoot);
        }
    },
};

/** All dev tools. */
export const devTools: Tool[] = [runLintTool, runBuildTool, runTestTool];
