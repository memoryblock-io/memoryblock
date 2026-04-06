import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutionResult, ToolContext } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

export const updateBlockConfigTool: Tool = {
    definition: {
        name: 'update_block_config',
        description: 'Update the block configuration properties natively on disk. Superblock permission required.',
        parameters: createSchema({
            key: { type: 'string', description: 'Path to config property (e.g. "tools.sandbox", "memory.maxContextTokens", "description")' },
            value: { type: 'string', description: 'JSON-stringified value to set' }
        }, ['key', 'value']),
        requiresApproval: true,
        requiredScope: 'system' // Only superblocks
    },
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
        const { key, value } = params as { key: string, value: string };
        try {
            const configPath = join(context.blockPath, 'config.json');
            const data = JSON.parse(await fsp.readFile(configPath, 'utf8'));
            
            const keys = key.split('.');
            let current = data;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = JSON.parse(value);

            await fsp.writeFile(configPath, JSON.stringify(data, null, 2), 'utf8');

            return { content: `Successfully updated '${key}' to ${value}.`, isError: false };
        } catch (err) {
            return { content: `Config update failed: ${(err as Error).message}`, isError: true };
        }
    }
};

export const configTools: Tool[] = [updateBlockConfigTool];
