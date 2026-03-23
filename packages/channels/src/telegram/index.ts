import { Bot, InlineKeyboard } from 'grammy';
import type { Channel, ChannelMessage, ApprovalRequest } from 'memoryblock';
import { loadAuth, log, t } from 'memoryblock';

/**
 * Telegram Channel — interactive bot-based communication via Grammy.
 * Routes messages to/from block monitors.
 * Message format: [block-name]/[monitor-name]\n[response]
 * System format:  [system]/[block-name]\n[message]
 */
export class TelegramChannel implements Channel {
    readonly name = 'telegram';
    private bot: Bot | null = null;
    private chatId: string;
    private blockName: string;
    private enableAlerts: boolean;
    private messageHandler: ((message: ChannelMessage) => void) | null = null;
    private pendingApprovals = new Map<string, (approved: boolean) => void>();
    private typingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(blockName: string, chatId: string, enableAlerts: boolean = true) {
        this.blockName = blockName;
        this.chatId = chatId;
        this.enableAlerts = enableAlerts;
    }

    async send(message: ChannelMessage): Promise<void> {
        if (!this.bot) return;

        // Stop typing indicator when response arrives
        this.stopTyping();

        let text: string;
        if (message.isSystem) {
            text = `_${this.escapeMarkdown(message.content)}_`;
        } else {
            text = `*${this.escapeMarkdown(message.monitorName)}* :: ${this.escapeMarkdown(message.blockName)}\n\n${message.content}`;
        }

        // Telegram has a 4096 char limit per message
        if (text.length > 4000) {
            const chunks = this.chunkText(text, 4000);
            for (const chunk of chunks) {
                await this.bot.api.sendMessage(this.chatId, chunk, { parse_mode: 'Markdown' });
            }
            return;
        }

        // Simulate streaming via progressive message editing
        // Skip for system messages and short responses
        if (!message.isSystem && text.length > 100) {
            await this.streamMessage(text);
        } else {
            await this.bot.api.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
        }
    }

    onMessage(handler: (message: ChannelMessage) => void): void {
        this.messageHandler = handler;
    }

    async requestApproval(request: ApprovalRequest): Promise<boolean> {
        if (!this.bot) return false;

        const approvalId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const text = `⚠️ *Approval Required*\n\n${this.escapeMarkdown(request.description)}\n\n_Block: ${this.escapeMarkdown(request.blockName)}_`;

        const keyboard = new InlineKeyboard()
            .text('✅ Approve', `approve:${approvalId}`)
            .text('❌ Deny', `deny:${approvalId}`);

        await this.bot.api.sendMessage(this.chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });

        return new Promise<boolean>((resolve) => {
            this.pendingApprovals.set(approvalId, resolve);
            // Timeout: auto-deny after 5 minutes
            setTimeout(() => {
                if (this.pendingApprovals.has(approvalId)) {
                    this.pendingApprovals.delete(approvalId);
                    resolve(false);
                }
            }, 5 * 60 * 1000);
        });
    }

    async start(): Promise<void> {
        const auth = await loadAuth();
        const botToken = auth.telegram?.botToken;

        if (!botToken) {
            throw new Error(
                'Telegram bot token not configured. Add it to ~/.memoryblock/ws/auth.json:\n' +
                '  { "telegram": { "botToken": "...", "chatId": "..." } }',
            );
        }

        // Override chatId from auth if not set
        if (!this.chatId && auth.telegram?.chatId) {
            this.chatId = auth.telegram.chatId;
        }

        this.bot = new Bot(botToken);

        // Handle incoming text messages
        this.bot.on('message:text', (ctx) => {
            if (String(ctx.chat.id) !== this.chatId) return;
            if (!this.messageHandler) return;

            // Show typing indicator while LLM processes
            this.startTyping();

            this.messageHandler({
                blockName: this.blockName,
                monitorName: 'user',
                content: ctx.message.text,
                isSystem: false,
                timestamp: new Date().toISOString(),
            });
        });

        // Handle approval callback queries
        this.bot.on('callback_query:data', async (ctx) => {
            const data = ctx.callbackQuery.data;
            if (!data) return;

            const [action, approvalId] = data.split(':');
            const resolver = this.pendingApprovals.get(approvalId);

            if (resolver) {
                const approved = action === 'approve';
                resolver(approved);
                this.pendingApprovals.delete(approvalId);

                await ctx.answerCallbackQuery({
                    text: approved ? '✅ Approved' : '❌ Denied',
                });

                // Edit the message to show the decision
                const originalText = ctx.callbackQuery.message?.text || '';
                const statusText = approved ? '\n\n✅ *Approved*' : '\n\n❌ *Denied*';
                await ctx.editMessageText(originalText + statusText, {
                    parse_mode: 'Markdown',
                });
            }
        });

        // Error handler — prevents the bot from crashing on transient errors
        this.bot.catch((err) => {
            const msg = err.message || '';
            // 409 = another instance took over polling — shut down silently
            if (msg.includes('409') || msg.includes('terminated by other getUpdates')) {
                log.error(t.channels.telegram.anotherInstance);
                this.bot?.stop();
                return;
            }
            log.error(`Telegram bot error: ${msg}`);
        });

        // Start polling (non-blocking — Grammy handles the event loop)
        // Wrap in error handling to catch polling-level failures (e.g. 409 conflict)
        this.bot.start({
            onStart: () => {
                if (this.enableAlerts && this.bot && this.chatId) {
                    this.bot.api.sendMessage(this.chatId, `_${this.escapeMarkdown(t.channels.telegram.isOnline(this.blockName))}_`, { parse_mode: 'Markdown' }).catch(() => {});
                }
            },
        }).catch((err: any) => {
            const msg = err?.message || String(err);
            if (msg.includes('409') || msg.includes('terminated by other getUpdates')) {
                log.error(t.channels.telegram.anotherRunning);
            } else {
                log.error(`Telegram polling stopped: ${msg}`);
            }
        });
    }

    async stop(): Promise<void> {
        if (this.bot) {
            this.stopTyping();
            if (this.enableAlerts) {
                try {
                    await this.bot.api.sendMessage(this.chatId, `_${this.escapeMarkdown(t.channels.telegram.isOffline(this.blockName))}_`, { parse_mode: 'Markdown' });
                } catch { /* ignore */ }
            }
            await this.bot.stop();
            this.bot = null;
        }
    }

    /**
     * Simulate streaming by sending a cursor, then progressively editing
     * the message with chunks of text. Respects Telegram rate limits (~1 edit/sec).
     */
    private async streamMessage(fullText: string): Promise<void> {
        if (!this.bot) return;

        // Split into sentence-ish chunks for natural reveal
        const chunks = this.splitIntoChunks(fullText);
        if (chunks.length <= 1) {
            await this.bot.api.sendMessage(this.chatId, fullText, { parse_mode: 'Markdown' });
            return;
        }

        // Send initial cursor
        let sent: any;
        try {
            sent = await this.bot.api.sendMessage(this.chatId, chunks[0] + ' ▍');
        } catch {
            // Markdown failed — send plain
            sent = await this.bot.api.sendMessage(this.chatId, chunks[0] + ' ▍');
        }

        // Progressively reveal
        let accumulated = chunks[0];
        for (let i = 1; i < chunks.length; i++) {
            await this.sleep(300);
            accumulated += chunks[i];
            const display = i < chunks.length - 1 ? accumulated + ' ▍' : accumulated;
            try {
                await this.bot.api.editMessageText(this.chatId, sent.message_id, display, { parse_mode: 'Markdown' });
            } catch {
                // Edit can fail if text hasn't changed enough — skip
            }
        }
    }

    /** Split text into chunks at sentence boundaries or natural breaking points for natural streaming without modifying characters. */
    private splitIntoChunks(text: string): string[] {
        const chunks: string[] = [];
        let i = 0;
        const minSize = 40;
        
        while (i < text.length) {
            let end = i + minSize;
            if (end >= text.length) {
                chunks.push(text.slice(i));
                break;
            }
            
            // Try to find a nice breaking point (space, newline) without consuming it
            while (end < text.length) {
                const char = text[end];
                if (char === ' ' || char === '\n') {
                    end++; // include the delimiter in the current chunk
                    break;
                }
                end++;
                
                // If we get too big without finding a space (e.g. a long URL), just cut it
                if (end - i > 120) break;
            }
            chunks.push(text.slice(i, end));
            i = end;
        }
        
        return chunks;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Send typing indicator — repeats every 4s (Telegram expires it after 5s). */
    private startTyping(): void {
        this.stopTyping();
        const sendTyping = () => {
            if (this.bot && this.chatId) {
                this.bot.api.sendChatAction(this.chatId, 'typing').catch(() => {});
            }
        };
        sendTyping(); // Immediately
        this.typingInterval = setInterval(sendTyping, 4000);
    }

    private stopTyping(): void {
        if (this.typingInterval) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
        }
    }

    /** Escape special Markdown chars for Telegram */
    private escapeMarkdown(text: string): string {
        // Only escape Markdown legacy characters to avoid rendering artifacts like `\.`
        return text.replace(/([_*[\]`])/g, '\\$1');
    }

    private chunkText(text: string, maxLen: number): string[] {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += maxLen) {
            chunks.push(text.slice(i, i + maxLen));
        }
        return chunks;
    }
}
