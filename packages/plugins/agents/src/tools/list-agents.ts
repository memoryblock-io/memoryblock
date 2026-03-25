
import { createSchema } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - workspace resolution cache issue
import { loadGlobalConfig, resolveBlocksDir, loadBlockConfig } from '@memoryblock/types';

export const listAgentsTool = {
    definition: {
        name: 'list_agents',
        description: 'Discovers available memoryblock sub-agents that can be queried or delegated tasks to.',
        parameters: createSchema({}),
        requiresApproval: false
    },
    async execute() {
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const entries = await fsp.readdir(blocksDir, { withFileTypes: true });

            const agents = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    try {
                        const blockPath = join(blocksDir, entry.name);
                        const config = await loadBlockConfig(blockPath);
                        let status = 'UNKNOWN';
                        try {
                            const pulseRaw = await fsp.readFile(join(blockPath, 'pulse.json'), 'utf-8');
                            status = JSON.parse(pulseRaw).status;
                        } catch { /* ignore */ }

                        agents.push(`- **${config.name}**: ${config.description} (Status: ${status})`);
                    } catch {
                        // skip invalid blocks
                    }
                }
            }

            if (agents.length === 0) return { content: 'No other agents found.', isError: false };
            return {
                content: `Available Agents:\n\n${agents.join('\n')}`,
                isError: false
            };
        } catch (err) {
            return { content: `Failed to list agents: ${(err as Error).message}`, isError: true };
        }
    }
};
