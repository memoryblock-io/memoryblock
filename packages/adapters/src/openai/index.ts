import type {
    LLMAdapter, LLMMessage, LLMResponse, ToolDefinition,
    TokenUsage
} from 'memoryblock';

export interface OpenAIAdapterConfig {
    model?: string;
    apiKey?: string;
    baseURL?: string;
    maxTokens?: number;
}

export class OpenAIAdapter implements LLMAdapter {
    readonly provider = 'openai';
    readonly model: string;
    private readonly apiKey: string;
    private readonly baseURL: string;
    private readonly maxTokens: number;

    constructor(config: OpenAIAdapterConfig = {}) {
        this.model = config.model || 'gpt-4o-mini';
        this.baseURL = config.baseURL || 'https://api.openai.com/v1';
        this.maxTokens = config.maxTokens || 4096;
        
        const key = config.apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('OpenAI API key is missing. Run `mblk auth openai` or set OPENAI_API_KEY');
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

        const openAiMessages = [];
        if (systemPrompt) {
            openAiMessages.push({ role: 'system', content: systemPrompt });
        }

        for (const msg of conversationMessages) {
            if (msg.role === 'assistant') {
                openAiMessages.push({
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: msg.toolCalls?.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.input)
                        }
                    }))
                });
            } else if (msg.role === 'tool' && msg.toolResults) {
                for (const tr of msg.toolResults) {
                    openAiMessages.push({
                        role: 'tool',
                        tool_call_id: tr.toolCallId,
                        content: tr.content
                    });
                }
            } else if (msg.role === 'user') {
                openAiMessages.push({
                    role: 'user',
                    content: msg.content || ''
                });
            }
        }

        const openAiTools = tools && tools.length > 0 ? tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        })) : undefined;

        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: openAiMessages,
                tools: openAiTools,
                max_tokens: this.maxTokens,
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`OpenAI API Error (${response.status}): ${errBody}`);
        }

        const data = await response.json();
        const choice = data.choices[0];
        const resMessage = choice.message;

        const message: LLMMessage = { role: 'assistant' };
        if (resMessage.content) {
            message.content = resMessage.content;
        }

        if (resMessage.tool_calls) {
            message.toolCalls = resMessage.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments || '{}')
            }));
        }

        const usage: TokenUsage = {
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0,
        };

        return {
            message,
            usage,
            stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
        };
    }
}
