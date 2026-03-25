
import { createSchema, createDefaultRegistry } from '@memoryblock/tools';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - workspace resolution cache issue
import { 
    loadGlobalConfig, resolveBlocksDir, loadBlockConfig, loadAuth,
    Monitor
} from 'memoryblock';

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

            // Load adapter natively
            const adapters = await import('@memoryblock/adapters');
            let adapter: any;
            const provider = blockConfig.adapter.provider || 'bedrock';
            if (provider === 'openai') {
                const auth = await loadAuth();
                adapter = new adapters.OpenAIAdapter({
                    model: blockConfig.adapter.model,
                    apiKey: auth?.openai?.apiKey || process.env.OPENAI_API_KEY || '',
                });
            } else if (provider === 'gemini') {
                const auth = await loadAuth();
                adapter = new adapters.GeminiAdapter({
                    model: blockConfig.adapter.model,
                    apiKey: auth?.gemini?.apiKey || process.env.GEMINI_API_KEY || '',
                });
            } else {
                adapter = new adapters.BedrockAdapter({
                    model: blockConfig.adapter.model,
                    region: blockConfig.adapter.region,
                    maxTokens: blockConfig.adapter.maxTokens,
                });
            }

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