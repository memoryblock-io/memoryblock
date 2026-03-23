import {
    BedrockRuntimeClient,
    ConverseCommand,
    type BedrockRuntimeClientConfig,
    type ContentBlock,
    type ConversationRole,
    type Message,
    type ToolConfiguration,
    type ToolInputSchema,
    type ToolResultContentBlock,
    type SystemContentBlock,
    type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type {
    LLMAdapter, LLMMessage, LLMResponse, ToolDefinition,
    ToolCall, StopReason, TokenUsage,
} from 'memoryblock';

export interface BedrockAdapterConfig {
    model?: string;
    region?: string;
    maxTokens?: number;
    accessKeyId?: string;
    secretAccessKey?: string;
}

// Singleton client cache per region:key
const clientCache = new Map<string, BedrockRuntimeClient>();

function getClient(region: string, accessKeyId?: string, secretAccessKey?: string): BedrockRuntimeClient {
    const cacheKey = `${region}:${accessKeyId || 'default'}`;
    if (clientCache.has(cacheKey)) {
        return clientCache.get(cacheKey)!;
    }

    const config: BedrockRuntimeClientConfig = {
        region,
        requestHandler: new NodeHttpHandler({
            connectionTimeout: 5000,
            requestTimeout: 60000,
        }),
    };

    // Use explicit credentials if provided, otherwise fall back to AWS SDK
    // default credential provider chain (env vars, ~/.aws/credentials,
    // AWS_PROFILE, IAM roles, SSO, etc.)
    if (accessKeyId && secretAccessKey) {
        config.credentials = { accessKeyId, secretAccessKey };
    }

    const client = new BedrockRuntimeClient(config);
    clientCache.set(cacheKey, client);
    return client;
}

/**
 * Bedrock adapter using the Converse API.
 * Supports native tool-use, handles message conversion to/from Bedrock format.
 * Self-contained — no dependency on @memoryblock/plugin-aws.
 */
export class BedrockAdapter implements LLMAdapter {
    readonly provider = 'bedrock';
    readonly model: string;
    private readonly region: string;
    private readonly maxTokens: number;
    private readonly accessKeyId: string;
    private readonly secretAccessKey: string;

    constructor(config: BedrockAdapterConfig = {}) {
        this.model = config.model || '';
        this.region = config.region || 'us-east-1';
        this.maxTokens = config.maxTokens || 4096;
        this.accessKeyId = config.accessKeyId || '';
        this.secretAccessKey = config.secretAccessKey || '';
    }

    async converse(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
        if (!this.model) {
            throw new Error('No model configured for this block. Run `mblk start <block>` to select one.');
        }

        const client = getClient(
            this.region,
            this.accessKeyId || undefined,
            this.secretAccessKey || undefined,
        );

        // Separate system messages from conversation
        const systemMessages = messages.filter((m) => m.role === 'system');
        const conversationMessages = messages.filter((m) => m.role !== 'system');

        const system: SystemContentBlock[] = systemMessages
            .map((m) => ({ text: m.content || '' }));

        const bedrockMessages = this.convertMessages(conversationMessages);
        const toolConfig = tools?.length ? this.convertTools(tools) : undefined;

        const command = new ConverseCommand({
            modelId: this.model,
            messages: bedrockMessages,
            system: system.length > 0 ? system : undefined,
            toolConfig,
            inferenceConfig: {
                maxTokens: this.maxTokens,
            },
        });

        const response = await client.send(command) as ConverseCommandOutput;

        if (!response.output?.message) {
            throw new Error('Bedrock returned empty response');
        }

        const usage: TokenUsage = {
            inputTokens: response.usage?.inputTokens || 0,
            outputTokens: response.usage?.outputTokens || 0,
            totalTokens: (response.usage?.inputTokens || 0) + (response.usage?.outputTokens || 0),
        };

        const stopReason = this.mapStopReason(response.stopReason);
        const message = this.parseResponseMessage(response.output.message);

        return { message, usage, stopReason };
    }

    /** Convert our LLMMessage[] to Bedrock Message[]. */
    private convertMessages(messages: LLMMessage[]): Message[] {
        const result: Message[] = [];

        for (const msg of messages) {
            if (msg.role === 'assistant') {
                const content: ContentBlock[] = [];
                if (msg.content) {
                    content.push({ text: msg.content });
                }
                if (msg.toolCalls) {
                    for (const tc of msg.toolCalls) {
                        content.push({
                            toolUse: {
                                toolUseId: tc.id,
                                name: tc.name,
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                input: tc.input as any,
                            },
                        });
                    }
                }
                result.push({ role: 'assistant' as ConversationRole, content });
            } else if (msg.role === 'tool' && msg.toolResults) {
                const content: ContentBlock[] = msg.toolResults.map((tr) => ({
                    toolResult: {
                        toolUseId: tr.toolCallId,
                        content: [{ text: tr.content }] as ToolResultContentBlock[],
                        status: tr.isError ? ('error' as const) : ('success' as const),
                    },
                }));
                result.push({ role: 'user' as ConversationRole, content });
            } else if (msg.role === 'user') {
                result.push({
                    role: 'user' as ConversationRole,
                    content: [{ text: msg.content || '' }],
                });
            }
        }

        return result;
    }

    /** Convert our ToolDefinition[] to Bedrock ToolConfiguration. */
    private convertTools(tools: ToolDefinition[]): ToolConfiguration {
        return {
            tools: tools.map((t) => ({
                toolSpec: {
                    name: t.name,
                    description: t.description,
                    inputSchema: {
                        json: t.parameters,
                    } as ToolInputSchema,
                },
            })),
        };
    }

    /** Parse Bedrock response message to our LLMMessage format. */
    private parseResponseMessage(message: Message): LLMMessage {
        let textContent = '';
        const toolCalls: ToolCall[] = [];

        for (const block of message.content || []) {
            if ('text' in block && block.text) {
                textContent += block.text;
            }
            if ('toolUse' in block && block.toolUse) {
                toolCalls.push({
                    id: block.toolUse.toolUseId || '',
                    name: block.toolUse.name || '',
                    input: (block.toolUse.input as Record<string, unknown>) || {},
                });
            }
        }

        return {
            role: 'assistant',
            content: textContent || undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
    }

    /** Map Bedrock stop reason to our enum. */
    private mapStopReason(reason?: string): StopReason {
        switch (reason) {
            case 'tool_use': return 'tool_use';
            case 'max_tokens': return 'max_tokens';
            case 'stop_sequence': return 'stop_sequence';
            default: return 'end_turn';
        }
    }
}
