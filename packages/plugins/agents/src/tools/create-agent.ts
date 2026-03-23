
import { createSchema } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - workspace resolution cache issue
import { loadGlobalConfig, resolveBlocksDir, saveBlockConfig, BlockConfigSchema } from 'memoryblock';

export const createAgentTool = {
    definition: {
        name: 'create_agent',
        description: 'Creates a new memoryblock sub-agent with a specific name, description, and model.',
        parameters: createSchema({
            name: { type: 'string', description: 'Agent identifier, lowercase alphanumeric and hyphens (e.g. "code-reviewer")' },
            description: { type: 'string', description: 'What this agent is designed to do' },
            model: { type: 'string', description: 'The LLM model to use. Defaults to bedrock but can be openai, gemini, or anthropic if api keys configured (e.g. "gpt-4o", "gemini-2.5-pro", "claude-3-5-sonnet-20241022").' }
        }, ['name', 'description']),
        requiresApproval: true
    },
    async execute(params: Record<string, unknown>) {
        const { name, description, model = 'anthropic.claude-3-haiku-20240307-v1:0' } = params as { name: string, description: string, model?: string };

        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
            return { content: 'Invalid name format. Use lowercase letters, numbers, and hyphens (max 32 chars).', isError: true };
        }

        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const blockPath = join(blocksDir, name);

            const exists = await fsp.stat(blockPath).then(() => true).catch(() => false);
            if (exists) {
                return { content: `Agent "${name}" already exists.`, isError: true };
            }

            await fsp.mkdir(blockPath, { recursive: true });

            // Determine provider natively based on common prefixes
            let provider = 'bedrock';
            if (model.includes('gpt-') || model.includes('o1-')) provider = 'openai';
            if (model.includes('gemini-')) provider = 'gemini';
            if (model.includes('claude-') && !model.includes('anthropic.')) provider = 'anthropic';

            // Adopt default config with sandbox enabled
            const config = BlockConfigSchema.parse({
                name,
                description,
                adapter: {
                    ...globalConfig.defaults.adapter,
                    provider,
                    model
                },
                goals: [description],
                tools: {
                    enabled: ['*'],
                    searchProvider: 'brave',
                    sandbox: true // Sub-agents must be sandboxed natively
                },
                channel: { type: 'cli' },
                permissions: {
                    scope: 'block',
                    allowShell: false,
                    allowNetwork: true,
                    maxTimeout: 120_000
                },
                memory: globalConfig.defaults.memory,
                pulse: globalConfig.defaults.pulse
            });

            await saveBlockConfig(blockPath, config);
            
            // Initial memory empty
            await fsp.writeFile(join(blockPath, 'memory.md'), '# Memory\n\n(no memory yet)', 'utf8');

            return {
                content: `Created sub-agent "${name}" successfully in sandboxed mode using ${provider}/${model}. You can now use query_agent to assign it tasks.`,
                isError: false
            };
        } catch (err) {
            return { content: `Failed to create agent: ${(err as Error).message}`, isError: true };
        }
    }
};
