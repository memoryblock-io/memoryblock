import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
}

export class McpClient {
    private proc?: ChildProcess;
    private requestId = 0;
    private pending = new Map<number | string, { resolve: (res: unknown) => void; reject: (err: Error) => void }>();
    private initialized = false;

    constructor(
        private command: string,
        private args: string[] = [],
        private env: Record<string, string> = {},
        private cwd?: string,
    ) {}

    async start(timeoutMs = 15_000): Promise<void> {
        if (this.proc) return;

        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.stop();
                reject(new Error(`MCP server connection timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            try {
                this.proc = spawn(this.command, this.args, {
                    cwd: this.cwd || process.cwd(),
                    env: { ...process.env, ...this.env },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                const rl = createInterface({ input: this.proc.stdout! });

                rl.on('line', (line) => {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('{')) return;
                    try {
                        const json = JSON.parse(trimmed);
                        if (json.id !== undefined && this.pending.has(json.id)) {
                            const handler = this.pending.get(json.id)!;
                            this.pending.delete(json.id);
                            if (json.error) {
                                handler.reject(new Error(json.error.message || JSON.stringify(json.error)));
                            } else {
                                handler.resolve(json.result);
                            }
                        }
                    } catch { /* ignore non-json lines */ }
                });

                this.proc.on('error', (err) => {
                    clearTimeout(timer);
                    reject(err);
                });

                this.proc.on('exit', (code) => {
                    for (const [, handler] of this.pending) {
                        handler.reject(new Error(`MCP server exited with code ${code}`));
                    }
                    this.pending.clear();
                    this.proc = undefined;
                    this.initialized = false;
                });

                // Send initialize handshake
                this.request('initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                        name: 'memoryblock',
                        version: '0.1.10',
                    },
                })
                    .then(async () => {
                        // Send notifications/initialized
                        this.notify('notifications/initialized', {});
                        this.initialized = true;
                        clearTimeout(timer);
                        resolve();
                    })
                    .catch((err) => {
                        clearTimeout(timer);
                        this.stop();
                        reject(err);
                    });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    private request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.proc || !this.proc.stdin) {
                return reject(new Error('MCP server process is not running'));
            }

            const id = ++this.requestId;
            this.pending.set(id, {
                resolve: resolve as (res: unknown) => void,
                reject,
            });

            const payload = JSON.stringify({
                jsonrpc: '2.0',
                id,
                method,
                params,
            }) + '\n';

            this.proc.stdin.write(payload);
        });
    }

    private notify(method: string, params: Record<string, unknown> = {}): void {
        if (!this.proc || !this.proc.stdin) return;
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
        }) + '\n';
        this.proc.stdin.write(payload);
    }

    async listTools(): Promise<McpTool[]> {
        if (!this.initialized) await this.start();
        const res = await this.request<{ tools?: McpTool[] }>('tools/list', {});
        return res.tools || [];
    }

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
        if (!this.initialized) await this.start();
        return await this.request<McpCallResult>('tools/call', {
            name,
            arguments: args,
        });
    }

    stop(): void {
        if (this.proc) {
            try {
                this.proc.kill();
            } catch { /* already dead */ }
            this.proc = undefined;
            this.initialized = false;
        }
    }
}
