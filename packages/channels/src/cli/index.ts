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
        if (message.isSystem) {
            // System messages: ultra-dim, compact
            console.log(THEME.system(`  │  ${message.content.replace(/\n/g, '\n  │  ')}`));
        } else {
            // Monitor response
            console.log('');
            
            // Compact header: monitor name is the highlight, block name is secondary
            const name = message.monitorName || message.blockName;
            const header = `${THEME.brandBg(` ${name} `)}${name !== message.blockName ? ` ${THEME.system(message.blockName)}` : ''}`;
            console.log(header);
            console.log('');
            console.log('');

            const formatted = this.formatContent(message.content);
            const columns = process.stdout.columns || 80;
            const maxWidth = columns - 2;

            // Word wrap + streaming
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

                // Streaming delay
                if (visualWordLength > 0 && !/^\s+$/.test(word)) {
                    await this.sleep(5 + Math.random() * 10);
                }
            }

            process.stdout.write('\n');
            if (message.costReport) {
                console.log(THEME.dim(`[${message.costReport}]`));
            }
            console.log('');
        }
    }

    onMessage(handler: (message: ChannelMessage) => void): void {
        this.messageHandler = handler;
    }

    async requestApproval(request: ApprovalRequest): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const rl = this.rl || createInterface({ input: process.stdin, output: process.stdout });
            const prompt = `\n${chalk.yellow('⚠  ' + request.description)}\n   ${THEME.system('approve?')} (y/n): `;

            rl.question(prompt, (answer: string) => {
                const approved = answer.trim().toLowerCase() === 'y';
                if (approved) {
                    console.log(chalk.green('  ✓ approved'));
                } else {
                    console.log(chalk.red('  ✗ denied'));
                }

                if (!this.rl) {
                    rl.close();
                }

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