import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

interface ManagedTask {
    id: string;
    command: string;
    cwd: string;
    startTime: number;
    endTime?: number;
    status: 'running' | 'completed' | 'failed' | 'killed';
    exitCode: number | null;
    outputLines: string[];
    process?: ChildProcess;
}

const MAX_STORED_LINES = 1000;
const tasks = new Map<string, ManagedTask>();
let taskCounter = 0;

function generateTaskId(): string {
    taskCounter++;
    return `task_${Date.now().toString(36)}_${taskCounter}`;
}

// ===== spawn_task =====
export const spawnTaskTool: Tool = {
    definition: {
        name: 'spawn_task',
        description: 'Launch a long-running or background command asynchronously (e.g. dev server, watcher, test run). Returns a taskId immediately without blocking the conversation.',
        parameters: createSchema(
            {
                command: { type: 'string', description: 'The shell command to run in the background.' },
                workingDir: { type: 'string', description: 'Working directory for the task. Defaults to workspace root.' },
            },
            ['command'],
        ),
        requiresApproval: true,
        requiresShell: true,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const command = params.command as string;
        const scope = context.permissions?.scope || 'block';

        if (!context.permissions?.allowShell && scope !== 'system') {
            return {
                content: `Shell access denied. Set allowShell: true via \`mblk permissions ${context.blockName} --allow-shell\`.`,
                isError: true,
            };
        }

        const cwd = (params.workingDir as string) || context.workingDir || context.blockPath;
        const taskId = generateTaskId();

        try {
            const isWin = process.platform === 'win32';
            const shell = isWin ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';
            const shellArgs = isWin ? ['/c', command] : ['-c', command];

            const proc = spawn(shell, shellArgs, {
                cwd,
                env: {
                    ...process.env,
                    HOME: process.env.HOME,
                    USERPROFILE: process.env.USERPROFILE,
                    FORCE_COLOR: '0',
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const task: ManagedTask = {
                id: taskId,
                command,
                cwd,
                startTime: Date.now(),
                status: 'running',
                exitCode: null,
                outputLines: [],
                process: proc,
            };

            const appendOutput = (data: Buffer | string) => {
                const text = data.toString();
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    if (line.length > 0) {
                        task.outputLines.push(line);
                    }
                }
                if (task.outputLines.length > MAX_STORED_LINES) {
                    task.outputLines = task.outputLines.slice(-MAX_STORED_LINES);
                }
            };

            proc.stdout?.on('data', appendOutput);
            proc.stderr?.on('data', appendOutput);

            proc.on('close', (code) => {
                task.endTime = Date.now();
                task.exitCode = code;
                task.status = task.status === 'killed' ? 'killed' : code === 0 ? 'completed' : 'failed';
                task.process = undefined;
            });

            proc.on('error', (err) => {
                task.endTime = Date.now();
                task.status = 'failed';
                task.outputLines.push(`Process error: ${err.message}`);
                task.process = undefined;
            });

            tasks.set(taskId, task);

            return {
                content: `Task spawned successfully.\nTask ID: \`${taskId}\`\nCommand: \`${command}\`\nStatus: running\n\nUse \`task_logs\` with taskId "${taskId}" to view output, or \`task_kill\` to terminate.`,
                isError: false,
            };
        } catch (err) {
            return {
                content: `Failed to spawn task: ${(err as Error).message}`,
                isError: true,
            };
        }
    },
};

// ===== task_status =====
export const taskStatusTool: Tool = {
    definition: {
        name: 'task_status',
        description: 'Check the status, runtime, and exit code of a background task.',
        parameters: createSchema(
            {
                taskId: { type: 'string', description: 'The task ID returned from spawn_task.' },
            },
            ['taskId'],
        ),
        requiresApproval: false,
        requiresShell: true,
    },
    async execute(params, _context): Promise<ToolExecutionResult> {
        const taskId = params.taskId as string;
        const task = tasks.get(taskId);

        if (!task) {
            return { content: `Task "${taskId}" not found.`, isError: true };
        }

        const durationMs = (task.endTime || Date.now()) - task.startTime;
        const durationSec = (durationMs / 1000).toFixed(1);

        const info = [
            `Task ID: ${task.id}`,
            `Command: ${task.command}`,
            `Status: ${task.status.toUpperCase()}`,
            `Runtime: ${durationSec}s`,
            `Exit Code: ${task.exitCode !== null ? task.exitCode : 'N/A (running)'}`,
            `Buffered Lines: ${task.outputLines.length}`,
        ].join('\n');

        return { content: info, isError: false };
    },
};

// ===== task_logs =====
export const taskLogsTool: Tool = {
    definition: {
        name: 'task_logs',
        description: 'View the latest stdout/stderr log output of a running or completed task. Returns the tail of logs to save tokens.',
        parameters: createSchema(
            {
                taskId: { type: 'string', description: 'The task ID.' },
                lines: { type: 'string', description: 'Number of recent lines to return (default: 50, max: 200).' },
            },
            ['taskId'],
        ),
        requiresApproval: false,
        requiresShell: true,
    },
    async execute(params, _context): Promise<ToolExecutionResult> {
        const taskId = params.taskId as string;
        const task = tasks.get(taskId);

        if (!task) {
            return { content: `Task "${taskId}" not found.`, isError: true };
        }

        const lineCount = Math.min(parseInt((params.lines as string) || '50', 10), 200);
        const slice = task.outputLines.slice(-lineCount);

        if (slice.length === 0) {
            return { content: `Task "${taskId}" has not produced any output yet.`, isError: false };
        }

        const header = `--- [${task.id}] ${task.status.toUpperCase()} (${slice.length} lines) ---`;
        return { content: `${header}\n${slice.join('\n')}`, isError: false };
    },
};

// ===== task_send_input =====
export const taskSendInputTool: Tool = {
    definition: {
        name: 'task_send_input',
        description: 'Send input text (stdin) to an interactive background task.',
        parameters: createSchema(
            {
                taskId: { type: 'string', description: 'The task ID.' },
                input: { type: 'string', description: 'The input string to write to stdin.' },
            },
            ['taskId', 'input'],
        ),
        requiresApproval: false,
        requiresShell: true,
    },
    async execute(params, _context): Promise<ToolExecutionResult> {
        const taskId = params.taskId as string;
        const input = params.input as string;
        const task = tasks.get(taskId);

        if (!task) {
            return { content: `Task "${taskId}" not found.`, isError: true };
        }

        if (task.status !== 'running' || !task.process || !task.process.stdin) {
            return { content: `Task "${taskId}" is not running (status: ${task.status}). Cannot send input.`, isError: true };
        }

        try {
            task.process.stdin.write(input + '\n');
            return { content: `Sent input to task "${taskId}".`, isError: false };
        } catch (err) {
            return { content: `Failed to write input: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== task_kill =====
export const taskKillTool: Tool = {
    definition: {
        name: 'task_kill',
        description: 'Terminate a running background task.',
        parameters: createSchema(
            {
                taskId: { type: 'string', description: 'The task ID to terminate.' },
            },
            ['taskId'],
        ),
        requiresApproval: true,
        requiresShell: true,
    },
    async execute(params, _context): Promise<ToolExecutionResult> {
        const taskId = params.taskId as string;
        const task = tasks.get(taskId);

        if (!task) {
            return { content: `Task "${taskId}" not found.`, isError: true };
        }

        if (task.status !== 'running' || !task.process) {
            return { content: `Task "${taskId}" is already stopped (status: ${task.status}).`, isError: false };
        }

        try {
            task.status = 'killed';
            task.process.kill('SIGTERM');
            // Hard kill backup after 3 seconds if not terminated
            setTimeout(() => {
                try {
                    if (task.process && !task.process.killed) {
                        task.process.kill('SIGKILL');
                    }
                } catch { /* already dead */ }
            }, 3000);

            return { content: `Task "${taskId}" termination signal sent.`, isError: false };
        } catch (err) {
            return { content: `Failed to kill task: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== list_tasks =====
export const listTasksTool: Tool = {
    definition: {
        name: 'list_tasks',
        description: 'List all background tasks and their current execution status.',
        parameters: createSchema({}, []),
        requiresApproval: false,
        requiresShell: true,
    },
    async execute(_params, _context): Promise<ToolExecutionResult> {
        if (tasks.size === 0) {
            return { content: 'No background tasks have been spawned.', isError: false };
        }

        const lines: string[] = ['### Background Tasks'];
        for (const task of tasks.values()) {
            const durationMs = (task.endTime || Date.now()) - task.startTime;
            const durationSec = (durationMs / 1000).toFixed(0);
            lines.push(
                `- **\`${task.id}\`**: \`${task.command}\` | Status: **${task.status}** | Duration: ${durationSec}s | Lines: ${task.outputLines.length}`
            );
        }

        return { content: lines.join('\n'), isError: false };
    },
};

export const taskManagerTools: Tool[] = [
    spawnTaskTool,
    taskStatusTool,
    taskLogsTool,
    taskSendInputTool,
    taskKillTool,
    listTasksTool,
];
