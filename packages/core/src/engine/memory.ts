import type { LLMAdapter, LLMMessage, TokenUsage } from 'memoryblock';
import { readTextSafe, atomicWrite } from '../utils/fs.js';
import { log } from '../cli/logger.js';
import { join } from 'node:path';

/**
 * Memory Manager: Implements the 80% rule.
 * When the active session hits the threshold, the LLM summarizes its learnings
 * into memory.md, and the session is reborn with fresh context.
 */
export class MemoryManager {
    private readonly maxTokens: number;
    private readonly threshold: number; // 0-1
    private accumulatedTokens: number = 0;

    constructor(maxContextTokens: number, thresholdPercent: number) {
        this.maxTokens = maxContextTokens;
        this.threshold = thresholdPercent / 100;
    }

    /** Track token usage from a response. */
    trackUsage(usage: TokenUsage): void {
        this.accumulatedTokens += usage.totalTokens;
    }

    /** Check if the accumulated tokens exceed the threshold. */
    shouldSummarize(): boolean {
        return this.accumulatedTokens >= this.maxTokens * this.threshold;
    }

    /** Get current token count. */
    getTokenCount(): number {
        return this.accumulatedTokens;
    }

    /** Reset token tracking after a rebirth. */
    reset(): void {
        this.accumulatedTokens = 0;
    }

    /** Load the block's memory.md. */
    async loadMemory(blockPath: string): Promise<string> {
        return readTextSafe(join(blockPath, 'memory.md'), '');
    }

    /**
     * Summarize the current session and write to memory.md.
     * Asks the LLM to distill its learnings.
     */
    async summarize(
        adapter: LLMAdapter,
        messages: LLMMessage[],
        blockPath: string,
    ): Promise<string> {
        const summarizePrompt: LLMMessage[] = [
            {
                role: 'system',
                content:
                    'You are a memory manager. Summarize the conversation into a structured memory document. ' +
                    'Include: key decisions made, important context, current goals, progress toward those goals, ' +
                    'and what should be done next. Write in markdown format. ' +
                    'CRITICAL: Keep the summary under 1500 words. Be concise. Omit pleasantries and redundancy.',
            },
            {
                role: 'user',
                content:
                    'Summarize this conversation for your future self. Focus on what was accomplished, ' +
                    'key learnings, and next steps:\n\n' +
                    messages
                        .filter((m) => m.role !== 'system')
                        .map((m) => `[${m.role}]: ${(m.content || '(tool interaction)').slice(0, 300)}`)
                        .join('\n'),
            },
        ];

        const response = await adapter.converse(summarizePrompt);
        const summary = response.message.content || '';

        const memoryContent = `# Monitor Memory\n\n> Last updated: ${new Date().toISOString()}\n\n${summary}\n`;
        await atomicWrite(join(blockPath, 'memory.md'), memoryContent);

        log.info(`Memory summarized (${this.accumulatedTokens} tokens → rebirth)`);
        this.reset();

        return memoryContent;
    }
}
