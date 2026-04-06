import { createSchema } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { loadGlobalConfig, resolveBlocksDir } from '@memoryblock/types';

export const messageAgentTool = {
    definition: {
        name: 'message_agent',
        description: 'Sends a direct message to an active sub-agent asynchronously without waiting for its execution to finish (unlike query_agent).',
        parameters: createSchema({
            agent_name: { type: 'string', description: 'Name of the sub-agent to message.' },
            content: { type: 'string', description: 'The instructions or update to pass along.' }
        }, ['agent_name', 'content']),
        requiresApproval: false
    },
    async execute(params: Record<string, unknown>, context: any) {
        const { agent_name, content } = params as { agent_name: string, content: string };
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const blockPath = join(blocksDir, agent_name);

            const exists = await fsp.stat(blockPath).then(() => true).catch(() => false);
            if (!exists) {
                return { content: `Agent "${agent_name}" does not exist.`, isError: true };
            }

            // Drop message into an inbox.md file as pipe memory for the sub-agent to process dynamically
            const inboxPath = join(blockPath, 'inbox.md');
            const msg = `\n\n[Message from ${context.blockName} at ${new Date().toISOString()}]:\n${content}`;
            
            await fsp.appendFile(inboxPath, msg, 'utf8');

            return {
                content: `Message async-dropped into ${agent_name}'s inbox successfully.`,
                isError: false
            };
        } catch (err) {
            return { content: `Failed to message agent: ${(err as Error).message}`, isError: true };
        }
    }
};
