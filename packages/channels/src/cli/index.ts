import { createInterface, type Interface, moveCursor, clearLine } from 'node:readline';
import chalk from 'chalk';
import type { Channel, ChannelMessage, ApprovalRequest } from '@memoryblock/types';

const THEME = {
    brand: chalk.hex('#7C3AED'),
    brandBg: chalk.bgHex('#7C3AED').white.bold,
    founderBg: chalk.bgHex('#1c64c8ff').white.bold,
    accent: chalk.hex('#10B981'),
    system: chalk.hex('#6B7280'),
    dim: chalk.dim,
    error: chalk.hex('#EF4444'),
};

/**
 * CLI Channel — minimal, clean terminal TUI.
 *
 * Design principles:
 * - System info is compact and dimmed
 * - Monitor responses are the visual focus
 * - Streaming effect for natural feel
 * - Status footer shows per-turn cost
 */
export class CLIChannel implements Channel {
    readonly name = 'cli';
    private rl: Interface | null = null;
    private messageHandler: ((message: ChannelMessage) => void) | null = null;
    private blockName: string;

    private lastSpeakerName: string | null = null;
    private isStreaming = false;

    constructor(blockName: string) {
        this.blockName = blockName;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private formatContent(content: string): string {
        // Markdown-lite formatting for terminal
        return content
            .replace(/\*\*(.*?)\*\*/g, (_, p1) => chalk.bold(p1))
            .replace(/`([^`]+)`/g, (_, p1) => chalk.cyan(p1))
            .replace(/_(.*?)_/g, (_, p1) => chalk.italic(p1))
            .replace(/\*(.*?)\*/g, (_, p1) => chalk.italic(p1));
    }

    async send(message: ChannelMessage): Promise<void> {
        const name = message.monitorName || message.blockName;

        if (message.isSystem) {
            // If the system message is from a monitor (e.g., tools), we should print the monitor header
            // so it doesn't look like it belongs to the previous speaker (Founder)
            if (name !== 'system' && this.lastSpeakerName !== name) {
                console.log('');
                const header = `${THEME.brandBg(` ${name} `)}${name !== message.blockName ? ` ${THEME.system(message.blockName)}` : ''}`;
                console.log(header);
                this.lastSpeakerName = name;
            } else if (this.lastSpeakerName === name) {
                // If it's a subsequent system message by the same monitor, don't add full spacing
            } else {
                console.log('');
            }

            // System messages: ultra-dim, compact
            console.log(THEME.system(`  │  ${message.content.replace(/\n/g, '\n  │  ')}`));
            // Do NOT reset lastSpeakerName if this was a monitor message (like a tool execution),
            // so that if the monitor types its normal un-systemed response next, it doesn't print a duplicate header.
            if (name === 'system') {
                this.lastSpeakerName = null; 
            }
        } else {
            // Compact header: monitor name is the highlight, block name is secondary
            if (this.lastSpeakerName !== name) {
                console.log('');
                const header = `${THEME.brandBg(` ${name} `)}${name !== message.blockName ? ` ${THEME.system(message.blockName)}` : ''}`;
                console.log(header);
                console.log('');
                this.lastSpeakerName = name;
            } else if (!this.isStreaming) {
                // Same speaker but distinct message segment, add slight spacing
                console.log('');
            }

            const formatted = this.formatContent(message.content);
            const columns = process.stdout.columns || 80;
            const maxWidth = columns - 2;

            if (!this.isStreaming && formatted.trim() !== '') {
                // Word wrap logic for non-streaming full responses (like tools message)
                let currentLineLength = 0;
                const words = formatted.split(/(\s+)/);

                // eslint-disable-next-line no-control-regex
                const getVisualLength = (str: string) => str.replace(/\u001b\[[0-9;]*m/g, '').length;

                for (const word of words) {
                    if (word.includes('\n')) {
                        process.stdout.write(word);
                        const lines = word.split('\n');
                        currentLineLength = getVisualLength(lines[lines.length - 1]);
                        continue;
                    }

                    const visualWordLength = getVisualLength(word);
                    if (currentLineLength + visualWordLength > maxWidth && currentLineLength > 0) {
                        process.stdout.write('\n');
                        currentLineLength = 0;
                        if (/^\s+$/.test(word)) continue;
                    }

                    process.stdout.write(word);
                    currentLineLength += visualWordLength;
                }
                process.stdout.write('\n');
            } else if (!this.isStreaming) {
                // The message might have just been empty or a pure stream finalize
                process.stdout.write('\n');
            } else {
                // We just finished streaming, so the text is fully printed on screen already! 
                // Let's cap off the end of the streaming line so costReport prints neatly
                process.stdout.write('\n');
            }

            if (message.costReport) {
                console.log(THEME.dim(`[${message.costReport}]`));
                this.lastSpeakerName = null; // Cost report closes the turn
            }
            this.isStreaming = false; // reset stream state
            console.log('');
        }
    }

    /**
     * Prepare the CLI for an incoming stream — prints the monitor header
     * so streamed text has proper speaker attribution.
     */
    prepareStream(monitorName: string, blockName: string): void {
        if (this.lastSpeakerName !== monitorName) {
            console.log('');
            const header = `${THEME.brandBg(` ${monitorName} `)}${monitorName !== blockName ? ` ${THEME.system(blockName)}` : ''}`;
            console.log(header);
            console.log('');
            this.lastSpeakerName = monitorName;
        }
    }

    async streamChunk(chunk: string): Promise<void> {
        if (!this.isStreaming) {
            this.isStreaming = true;
        }
        process.stdout.write(chalk.white(chunk));
    }

    onMessage(handler: (message: ChannelMessage) => void): void {
        this.messageHandler = handler;
    }

    async requestApproval(request: ApprovalRequest): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const rl = this.rl || createInterface({ input: process.stdin, output: process.stdout });

            console.log('');
            console.log(chalk.bgYellow.black(' ⚠ APPROVAL REQUIRED '));
            console.log('');
            console.log(`  ${chalk.bold(request.toolName)} ${THEME.dim('·')} ${THEME.dim(request.toolDescription || request.description)}`);
            console.log(`  ${THEME.dim(`${request.blockName} · ${request.monitorName}`)}`);
            console.log('');
            console.log(`  ${chalk.yellow('A')} ${THEME.dim('or')} ${chalk.yellow('Enter')} ${THEME.dim('= approve')}  ·  ${chalk.yellow('D')} ${THEME.dim('= deny')}`);

            rl.question('  ', (answer: string) => {
                const lower = answer.trim().toLowerCase();
                const approved = lower === 'a' || lower === 'approve' || lower === 'y' || answer.trim() === '';

                moveCursor(process.stdout, 0, -1);
                clearLine(process.stdout, 0);
                if (approved) {
                    console.log(chalk.green(`  ✓ ${request.toolName} approved`));
                } else {
                    console.log(chalk.red(`  ✗ ${request.toolName} denied`));
                }
                console.log('');

                if (!this.rl) rl.close();
                resolve(approved);
            });
        });
    }

    async start(): Promise<void> {
        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        console.log('');
        console.log(THEME.system('  ╭──────────────────────────────────────────────────╮'));
        console.log(THEME.system('  │') + ' type a message and press enter. ctrl+c to exit.  ' + THEME.system('│'));
        console.log(THEME.system('  │') + ' commands: /status, /create-block <name>          ' + THEME.system('│'));
        console.log(THEME.system('  ╰──────────────────────────────────────────────────╯'));
        console.log('');

        this.rl.on('line', (line: string) => {
            const content = line.trim();
            if (!content) return;
            
            // In the native terminal, the user's input remains above.
            // We clear their raw input line and replace it with a styled Founder label.
            moveCursor(process.stdout, 0, -1);
            clearLine(process.stdout, 0);
            console.log(`\n${THEME.founderBg(' Founder ')} ${content}`);
            this.lastSpeakerName = 'user';

            if (this.messageHandler) {
                this.messageHandler({
                    blockName: this.blockName,
                    monitorName: 'user',
                    content,
                    isSystem: false,
                    timestamp: new Date().toISOString(),
                });
            }
        });

        // Forward SIGINT to the process so the shutdown handler fires on first Ctrl+C
        this.rl.on('SIGINT', () => {
            process.emit('SIGINT' as any);
        });

        this.rl.on('close', () => {
            this.rl = null;
        });

        while (this.rl) {
            await this.sleep(1000);
        }
    }

    async stop(): Promise<void> {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
    }
}