import type { Channel, ChannelMessage, ApprovalRequest } from 'memoryblock';

/**
 * MultiChannelManager allows the monitor to bind to multiple channels simultaneously
 * (e.g. CLI and Telegram at the same time) and intelligently route responses
 * back to the channel that originated the message.
 */
export class MultiChannelManager implements Channel {
    readonly name = 'multi';
    private channels: Map<string, Channel> = new Map();
    private lastActiveChannel: string = 'cli'; // default to CLI for autonomous actions
    private messageHandler: ((message: ChannelMessage) => void) | null = null;

    constructor(initialChannels: Channel[]) {
        for (const ch of initialChannels) {
            this.channels.set(ch.name, ch);
        }
    }

    addChannel(channel: Channel): void {
        this.channels.set(channel.name, channel);
        if (this.messageHandler) {
            this.bindChannelHandler(channel);
        }
    }

    getActiveChannels(): string[] {
        return Array.from(this.channels.keys());
    }

    private bindChannelHandler(channel: Channel): void {
        channel.onMessage((msg) => {
            // Track where this message came from so we can reply there
            this.lastActiveChannel = channel.name;
            if (this.messageHandler) {
                this.messageHandler({ ...msg, _sourceChannel: channel.name });
            }
        });
    }

    onMessage(handler: (message: ChannelMessage) => void): void {
        this.messageHandler = handler;
        // Bind to all currently registered channels
        for (const channel of this.channels.values()) {
            this.bindChannelHandler(channel);
        }
    }

    async send(message: ChannelMessage): Promise<void> {
        // Find which channel to route the response to.
        // 1. Explicit target channel (if set)
        // 2. The channel that sent the last user message
        // 3. Fallback to CLI
        const targetName = message._targetChannel || this.lastActiveChannel;
        const channel = this.channels.get(targetName);

        if (channel) {
            await channel.send(message);
        } else {
            console.warn(`[MultiChannelManager] Target channel '${targetName}' not found. active: ${Array.from(this.channels.keys()).join(',')}`);
        }
    }

    async requestApproval(request: ApprovalRequest): Promise<boolean> {
        // Route approval request to the currently active channel
        const channel = this.channels.get(this.lastActiveChannel);
        if (channel) {
            return channel.requestApproval(request);
        }
        return false;
    }

    async start(): Promise<void> {
        const starts = Array.from(this.channels.values()).map(ch => ch.start());
        await Promise.all(starts);
    }

    async stop(): Promise<void> {
        const stops = Array.from(this.channels.values()).map(ch => ch.stop());
        await Promise.all(stops);
    }
}
