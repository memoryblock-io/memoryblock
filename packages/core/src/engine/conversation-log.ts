import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

/**
 * Conversation logger — writes all interactions to timestamped .txt files
 * in the block's logs/ directory.
 *
 * Log format:
 * ---
 * [2025-03-12 00:09:51] [CHANNEL:telegram] [FROM:user] [CHAT:5315436002]
 * Hello, how are you?
 *
 * [2025-03-12 00:09:54] [CHANNEL:telegram] [FROM:monitor:Sam] [EMOJI:🌟]
 * I'm doing well! How can I help you today?
 * ---
 */
export class ConversationLogger {
    private logDir: string;
    private logFile: string;
    private buffer: string[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(blockPath: string) {
        this.logDir = join(blockPath, 'logs');
        // Temporary filename until init() provides block name and channel
        this.logFile = join(this.logDir, `session-${Date.now()}.txt`);
    }

    async init(blockName: string, monitorName: string, channelType: string): Promise<void> {
        await fsp.mkdir(this.logDir, { recursive: true });

        // Build filename: {blockName}-{channelType}-{timestamp}.txt
        const now = new Date();
        const stamp = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 16);
        this.logFile = join(this.logDir, `${blockName}-${channelType}-${stamp}.txt`);

        const header = [
            '═'.repeat(60),
            `SESSION START: ${new Date().toISOString()}`,
            `Block: ${blockName}`,
            `Monitor: ${monitorName}`,
            `Channel: ${channelType}`,
            '═'.repeat(60),
            '',
        ].join('\n');
        await fsp.writeFile(this.logFile, header, 'utf-8');
    }

    logUser(content: string, meta: { channel: string; chatId?: string }): void {
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const chatPart = meta.chatId ? ` [CHAT:${meta.chatId}]` : '';
        const entry = `[${ts}] [CHANNEL:${meta.channel}] [FROM:user]${chatPart}\n${content}\n\n`;
        this.buffer.push(entry);
        this.scheduleFlush();
    }

    logMonitor(content: string, meta: { channel: string; monitorName: string; emoji?: string }): void {
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const emojiPart = meta.emoji ? ` [EMOJI:${meta.emoji}]` : '';
        const entry = `[${ts}] [CHANNEL:${meta.channel}] [FROM:monitor:${meta.monitorName}]${emojiPart}\n${content}\n\n`;
        this.buffer.push(entry);
        this.scheduleFlush();
    }

    logSystem(message: string): void {
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const entry = `[${ts}] [SYSTEM]\n${message}\n\n`;
        this.buffer.push(entry);
        this.scheduleFlush();
    }

    async close(): Promise<void> {
        if (this.flushTimer) clearTimeout(this.flushTimer);
        await this.flush();
        const footer = `\n${'═'.repeat(60)}\nSESSION END: ${new Date().toISOString()}\n${'═'.repeat(60)}\n`;
        await fsp.appendFile(this.logFile, footer, 'utf-8');
    }

    private scheduleFlush(): void {
        if (this.flushTimer) clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), 500);
    }

    private async flush(): Promise<void> {
        if (!this.buffer.length) return;
        const content = this.buffer.join('');
        this.buffer = [];
        await fsp.appendFile(this.logFile, content, 'utf-8');
    }
}