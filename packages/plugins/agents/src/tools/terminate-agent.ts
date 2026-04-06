
import { createSchema } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - workspace resolution cache issue
import { loadGlobalConfig, resolveBlocksDir } from '@memoryblock/types';

export const terminateAgentTool = {
    definition: {
        name: 'terminate_agent',
        description: 'Instantly destroys a sub-agent and clears its isolated context/memory to save resources when its task is complete.',
        parameters: createSchema({
            agent_name: { type: 'string', description: 'Name of the sub-agent to terminate.' }
        }, ['agent_name']),
        requiresApproval: true
    },
    async execute(params: Record<string, unknown>) {
        const { agent_name } = params as { agent_name: string };
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const blockPath = join(blocksDir, agent_name);

            const exists = await fsp.stat(blockPath).then(() => true).catch(() => false);
            if (!exists) {
                return { content: `Agent "${agent_name}" does not exist.`, isError: true };
            }

            await fsp.rm(blockPath, { recursive: true, force: true });
            return {
                content: `Sub-agent "${agent_name}" successfully terminated and memories cleared.`,
                isError: false
            };
        } catch (err) {
            return { content: `Failed to terminate agent: ${(err as Error).message}`, isError: true };
        }
    }
};
