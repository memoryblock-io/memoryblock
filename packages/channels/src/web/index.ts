import { promises as fsp, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Channel, ChannelMessage, ApprovalRequest } from '../base.js';

export class WebChannel implements Channel {
    readonly name = 'web';
    private blockPath: string;
    private chatFile: string;
    private onMessageHandler: ((message: ChannelMessage) => void) | null = null;
    private watcher: FSWatcher | null = null;
    private running = false;
    private pendingWrite = Promise.resolve();
    private activeTimers = new Set<NodeJS.Timeout>();
    private pollInterval: NodeJS.Timeout | null = null;
    private isProcessing = false;

    constructor(private blockName: string, private basePath: string) {
        this.blockPath = basePath;
        this.chatFile = join(this.blockPath, 'chat.json');
    }

    onMessage(handler: (message: ChannelMessage) => void): void {
        this.onMessageHandler = handler;
    }

    private async processChatLog() {
        if (!this.running || this.isProcessing) return;
        this.isProcessing = true;
        try {
            // Wait for any pending writes to complete before reading
            await this.pendingWrite;

            const raw = await fsp.readFile(this.chatFile, 'utf8');
            const msgs = JSON.parse(raw) as any[];
            let changed = false;

            for (const m of msgs) {
                if (m.role === 'user' && !m.processed) {
                    m.processed = true;
                    changed = true;
                    if (this.onMessageHandler) {
                        this.onMessageHandler({
                            blockName: this.blockName,
                            monitorName: 'Web Chat',
                            content: m.content,
                            isSystem: false,
                            timestamp: m.timestamp || new Date().toISOString()
                        });
                    }
                }
            }

            if (changed) {
                // Enqueue write to prevent race conditions during rapid writes
                this.pendingWrite = this.pendingWrite.then(() =>
                    fsp.writeFile(this.chatFile, JSON.stringify(msgs, null, 4), 'utf8')
                ).catch(() => {});
            }
        } catch {
            // chat.json doesn't exist or is invalid, ignore
        } finally {
            this.isProcessing = false;
        }
    }

    async send(msg: ChannelMessage): Promise<void> {
        this.pendingWrite = this.pendingWrite.then(async () => {
            let msgs: any[] = [];
            try {
                const raw = await fsp.readFile(this.chatFile, 'utf8');
                msgs = JSON.parse(raw);
            } catch {
                msgs = [];
            }

            msgs.push({
                role: msg.isSystem ? 'system' : 'assistant',
                content: msg.content,
                timestamp: msg.timestamp || new Date().toISOString(),
                processed: true
            });

            await fsp.writeFile(this.chatFile, JSON.stringify(msgs, null, 4), 'utf8');
        }).catch(err => {
            console.error('[WebChannel] Failed to write out message:', err);
        });
        await this.pendingWrite;
    }

    async streamChunk(chunk: string): Promise<void> {
        try {
            const port = process.env.MBLK_PORT || 8420;
            await fetch(`http://127.0.0.1:${port}/api/blocks/${this.blockName}/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunk })
            });
        } catch {
            // Ignore errors if API server is not running or unreachable
        }
    }

    async requestApproval(req: ApprovalRequest): Promise<boolean> {
        // Not supporting dynamic tool approval over WebChat natively yet
        await this.send({
            blockName: req.blockName,
            monitorName: req.monitorName,
            content: `[System] Action blocked because Web Channel doesn't support manual approvals yet. Action: ${req.toolName}`,
            isSystem: true,
            timestamp: new Date().toISOString()
        });
        return false;
    }

    async start(): Promise<void> {
        this.running = true;
        try {
            // Initial scan for any pending messages
            await this.processChatLog();
            
            // fs.watch — primary mechanism, fires on file changes
            let debounceTimer: NodeJS.Timeout | null = null;
            this.watcher = watch(this.blockPath, (eventType, filename) => {
                if (filename === 'chat.json' && this.running) {
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this.processChatLog();
                    }, 200);
                    this.activeTimers.add(debounceTimer);
                }
            });

            // Polling fallback — fs.watch on macOS (FSEvents) can miss events
            // when files are written by a different process. Poll every 2s as a safety net.
            this.pollInterval = setInterval(() => {
                if (this.running) {
                    this.processChatLog();
                }
            }, 2000);
        } catch (err: unknown) {
            console.warn(`[WebChannel] Unable to start watching ${this.blockPath}: ${(err as Error).message}`);
        }
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        for (const timer of this.activeTimers) {
            clearTimeout(timer);
        }
        this.activeTimers.clear();
    }
}