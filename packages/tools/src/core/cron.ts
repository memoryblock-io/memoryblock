import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

function getWsRoot(): string {
    return process.env.MEMORYBLOCK_WS_DIR || join(homedir(), '.memoryblock', 'ws');
}

export const scheduleCronJobTool: Tool = {
    definition: {
        name: 'schedule_cron_job',
        description: 'Creates a new scheduled cron job that will wake up and execute instructions/scripts on the specified block/program.',
        parameters: createSchema({
            name: { type: 'string', description: 'Unique identifier for the cron job' },
            cron_expression: { type: 'string', description: 'Standard cron expression (e.g., "0 * * * *" for hourly)' },
            instruction: { type: 'string', description: 'The text instruction, command script, or prompt to execute when the cron triggers.' },
            target: { type: 'string', description: 'The target block name, agent name, or systemic program to run the instruction against.' }
        }, ['name', 'cron_expression', 'instruction', 'target']),
        requiresApproval: true
    },
    async execute(params: Record<string, unknown>): Promise<ToolExecutionResult> {
        const { name, cron_expression, instruction, target } = params as { name: string, cron_expression: string, instruction: string, target: string };
        try {
            const cronsPath = join(getWsRoot(), 'crons.json');
            const data = await fsp.readFile(cronsPath, 'utf8').catch(() => '{}');
            const crons = JSON.parse(data);

            crons[name] = { cron_expression, instruction, target, createdAt: new Date().toISOString() };
            
            await fsp.writeFile(cronsPath, JSON.stringify(crons, null, 2), 'utf8');
            return { content: `Cron job '${name}' successfully scheduled.`, isError: false };
        } catch (err) {
            return { content: `Failed to schedule cron: ${(err as Error).message}`, isError: true };
        }
    }
};

export const listCronJobsTool: Tool = {
    definition: {
        name: 'list_cron_jobs',
        description: 'Lists all active cron jobs in the workspace.',
        parameters: createSchema({}, []),
        requiresApproval: false
    },
    async execute(): Promise<ToolExecutionResult> {
        try {
            const cronsPath = join(getWsRoot(), 'crons.json');
            const data = await fsp.readFile(cronsPath, 'utf8').catch(() => '{}');
            const crons = JSON.parse(data);

            const names = Object.keys(crons);
            if (names.length === 0) return { content: 'No active cron jobs found.', isError: false };

            const out = names.map(n => `- **${n}**: "${crons[n].cron_expression}" (Target: ${crons[n].target}) -> ${crons[n].instruction}`);
            return { content: out.join('\n'), isError: false };
        } catch (err) {
            return { content: `Failed to list crons: ${(err as Error).message}`, isError: true };
        }
    }
};

export const removeCronJobTool: Tool = {
    definition: {
        name: 'remove_cron_job',
        description: 'Removes an actively scheduled cron job.',
        parameters: createSchema({
            name: { type: 'string', description: 'Unique identifier of the cron job' }
        }, ['name']),
        requiresApproval: true
    },
    async execute(params: Record<string, unknown>): Promise<ToolExecutionResult> {
        const { name } = params as { name: string };
        try {
            const cronsPath = join(getWsRoot(), 'crons.json');
            const data = await fsp.readFile(cronsPath, 'utf8').catch(() => '{}');
            const crons = JSON.parse(data);

            if (!crons[name]) return { content: `Cron job '${name}' not found.`, isError: true };

            delete crons[name];
            await fsp.writeFile(cronsPath, JSON.stringify(crons, null, 2), 'utf8');

            return { content: `Cron job '${name}' removed successfully.`, isError: false };
        } catch (err) {
            return { content: `Failed to remove cron: ${(err as Error).message}`, isError: true };
        }
    }
};

export const cronTools: Tool[] = [scheduleCronJobTool, listCronJobsTool, removeCronJobTool];