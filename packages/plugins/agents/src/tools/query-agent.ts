
import { createSchema, createDefaultRegistry } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - workspace resolution cache issue
import { 
    loadGlobalConfig, resolveBlocksDir, loadBlockConfig, loadAuth,
    Monitor
} from '@memoryblock/core';

// Quick inline OrchestratorChannel for interception
class OrchestratorChannel {
    public readonly name = 'orchestrator';
    private messageHandler: ((msg: any) => void) | null = null;
    private resolveResponse: ((res: string) => void) | null = null;
    private finalResponse = '';

    onMessage(handler: (msg: any) => void) {
        this.messageHandler = handler;
    }

    async send(msg: any) {
        if (!msg.isSystem && msg.content) {
            this.finalResponse = msg.content;
            if (this.resolveResponse) {
                this.resolveResponse(this.finalResponse);
            }
        }
    }

    async requestApproval() {
        // Sub-agents auto-deny unapproved actions in orchestration
        return false;
    }

    async start() {}
    async stop() {}

    simulateUser(content: string) {
        if (this.messageHandler) {
            this.messageHandler({
                blockName: 'orchestrator',
                monitorName: 'orchestrator',
                content,
                isSystem: false,
                timestamp: new Date().toISOString()
            });
        }
    }

    waitForResponse(): Promise<string> {
        return new Promise(resolve => {
            this.resolveResponse = resolve;
        });
    }
}

export const queryAgentTool = {
    definition: {
        name: 'query_agent',
        description: 'Delegates a task to a sub-agent. The orchestrator will pause until the sub-agent completes the request and returns its response.',
        parameters: createSchema({
            agent_name: { type: 'string', description: 'Name of the sub-agent to query.' },
            prompt: { type: 'string', description: 'The objective, task, or question to delegate to the sub-agent.' }
        }, ['agent_name', 'prompt']),
        requiresApproval: true // Delegating tasks is a major action
    },
    async execute(params: Record<string, unknown>) {
        const { agent_name, prompt } = params as { agent_name: string, prompt: string };

        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), agent_name);

            const exists = await fsp.stat(blockPath).then(() => true).catch(() => false);
            if (!exists) {
                return { content: `Agent "${agent_name}" does not exist. Use create_agent first.`, isError: true };
            }

            const blockConfig = await loadBlockConfig(blockPath);

            // Load adapter — single aiplug-backed factory. All providers (OpenAI,
//             Google/Gemini, Anthropic, Ollama, Bedrock, MiniMax, …) flow through
//             `createMemoryAdapter`, which itself delegates auth resolution to
//             aiplug's introspection. Per-provider classes used to live here;
//             they have all been removed.
            const { createMemoryAdapter } = await import('@memoryblock/adapters');
            const auth = await loadAuth();
            const provider = blockConfig.adapter.provider || 'bedrock';
            const adapter = createMemoryAdapter({
                provider,
                model: blockConfig.adapter.model,
                ...(auth?.aws?.accessKeyId && auth?.aws?.secretAccessKey
                    ? { apiKey: `${auth.aws.accessKeyId}:${auth.aws.secretAccessKey}` }
                    : {}),
                providerOptions: {
                    ...(auth?.aws?.accessKeyId ? { accessKeyId: auth.aws.accessKeyId } : {}),
                    ...(auth?.aws?.secretAccessKey ? { secretAccessKey: auth.aws.secretAccessKey } : {}),
                    ...(auth?.aws?.region ? { region: auth.aws.region } : {}),
                },
            });

            const registry = createDefaultRegistry();
            const channel = new OrchestratorChannel();

            const monitor = new Monitor({
                blockPath,
                blockConfig,
                adapter,
                registry,
                channel: channel as any
            });

            // Start monitor
            await monitor.start();
            
            // Push prompt
            channel.simulateUser(prompt);

            // Wait until the monitor emits a non-system message
            const finalResponse = await channel.waitForResponse();

            // Stop monitor cleanup
            await monitor.stop();

            return {
                content: `Response from ${agent_name}:\n\n${finalResponse}`,
                isError: false
            };
        } catch (err) {
            return { content: `Agent query failed: ${(err as Error).message}`, isError: true };
        }
    }
};