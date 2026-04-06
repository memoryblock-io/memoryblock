import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutionResult, ToolContext } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

export const getTokenUsageTool: Tool = {
    definition: {
        name: 'get_token_usage',
        description: 'Check active token usage for this block (session and all-time totals).',
        parameters: createSchema({}, []),
        requiresApproval: false
    },
    async execute(_params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
        try {
            const tokenFile = join(context.blockPath, 'costs.json');
            const raw = await fsp.readFile(tokenFile, 'utf-8').catch(() => null);
            if (!raw) return { content: 'No token usage data found for this block yet.', isError: false };
            const data = JSON.parse(raw);
            return {
                content: [
                    'Token Usage:',
                    `- Session Input: ${(data.sessionInput || 0).toLocaleString()} tokens`,
                    `- Session Output: ${(data.sessionOutput || 0).toLocaleString()} tokens`,
                    `- All-Time Input: ${(data.totalInput || 0).toLocaleString()} tokens`,
                    `- All-Time Output: ${(data.totalOutput || 0).toLocaleString()} tokens`,
                ].join('\n'),
                isError: false
            };
        } catch (err) {
            return { content: `Failed to read token data: ${(err as Error).message}`, isError: true };
        }
    }
};

export const metricsTools: Tool[] = [getTokenUsageTool];
