import type {
    LLMAdapter, LLMMessage, LLMResponse, ToolDefinition,
    ToolCall, TokenUsage
} from '@memoryblock/types';

export interface AnthropicAdapterConfig {
    model?: string;
    apiKey?: string;
    baseURL?: string;
    maxTokens?: number;
}

export class AnthropicAdapter implements LLMAdapter {
    readonly provider = 'anthropic';
    readonly model: string;
    private readonly apiKey: string;
    private readonly baseURL: string;
    private readonly maxTokens: number;

    constructor(config: AnthropicAdapterConfig = {}) {
        this.model = config.model || 'claude-3-5-sonnet-20241022';
        this.baseURL = config.baseURL || 'https://api.anthropic.com/v1/messages';
        this.maxTokens = config.maxTokens || 4096;
        
        const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!key) {
            throw new Error('Anthropic API key is missing. Run `mblk auth anthropic` or set ANTHROPIC_API_KEY');
        }
        this.apiKey = key;
    }

    async converse(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
        let systemPrompt = '';
        const conversationMessages = messages.filter((m) => {
            if (m.role === 'system') {
                systemPrompt += (systemPrompt ? '\n\n' : '') + m.content;
                return false;
            }
            return true;
        });

        const anthropicMessages = [];

        for (const msg of conversationMessages) {
            if (msg.role === 'assistant') {
                const content: any[] = [];
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    for (const tc of msg.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.name,
                            input: tc.input
                        });
                    }
                }
                if (content.length > 0) {
                    anthropicMessages.push({ role: 'assistant', content });
                }
            } else if (msg.role === 'tool' && msg.toolResults) {
                const content: any[] = [];
                for (const tr of msg.toolResults) {
                    content.push({
                        type: 'tool_result',
                        tool_use_id: tr.toolCallId,
                        content: tr.content,
                        is_error: tr.isError || false
                    });
                }
                anthropicMessages.push({ role: 'user', content });
            } else if (msg.role === 'user') {
                anthropicMessages.push({
                    role: 'user',
                    content: msg.content || ''
                });
            }
        }

        const anthropicTools = tools && tools.length > 0 ? tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: {
                type: 'object',
                properties: t.parameters?.properties || {},
                required: t.parameters?.required || []
            }
        })) : undefined;

        const payload: any = {
            model: this.model,
            max_tokens: this.maxTokens,
            messages: anthropicMessages,
        };

        if (systemPrompt) {
            payload.system = systemPrompt;
        }

        if (anthropicTools) {
            payload.tools = anthropicTools;
        }

        const response = await fetch(this.baseURL, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Anthropic API Error (${response.status}): ${errBody}`);
        }

        const data = await response.json();

        const message: LLMMessage = { role: 'assistant' };
        let textContent = '';
        const toolCalls: ToolCall[] = [];

        for (const block of data.content || []) {
            if (block.type === 'text') {
                textContent += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    input: block.input
                });
            }
        }

        if (textContent) message.content = textContent;
        if (toolCalls.length > 0) message.toolCalls = toolCalls;

        const usage: TokenUsage = {
            inputTokens: data.usage?.input_tokens || 0,
            outputTokens: data.usage?.output_tokens || 0,
            totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        };

        return {
            message,
            usage,
            stopReason: data.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn'
        };
    }
}