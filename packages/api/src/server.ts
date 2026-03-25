import { join, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import type { Server, ServerWebSocket } from 'bun';
import {
    loadGlobalConfig, resolveBlocksDir,
    loadBlockConfig, loadAuth, saveGlobalConfig,
} from 'memoryblock';
import { validateAuthToken } from './auth.js';

export interface ApiServerConfig {
    port: number;
    authToken: string;
    workspacePath: string;
    webRoot?: string;
}

interface WsData {
    block?: string;
}

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const API_VERSION = '0.3.0-alpha';

/**
 * Built-in HTTP & WebSocket Server using Bun.serve.
 * Zero external dependencies.
 */
export class ApiServer {
    private server: Server<WsData> | null = null;
    private config: ApiServerConfig;
    // Map of blockName -> Set of WebSocket clients
    private subscribers: Map<string, Set<ServerWebSocket<WsData>>> = new Map();
    // Map of blockName -> fs.FSWatcher
    private watchers: Map<string, FSWatcher> = new Map();

    constructor(config: ApiServerConfig) {
        this.config = config;
    }

    private extractToken(req: Request): string | null {
        const auth = req.headers.get('authorization');
        if (auth?.startsWith('Bearer ')) return auth.slice(7);
        const url = new URL(req.url);
        return url.searchParams.get('token');
    }

    private async getDynamicToken(): Promise<string> {
        try {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const tokenPath = join(this.config.workspacePath, '.api-token');
            const existing = await readFile(tokenPath, 'utf-8');
            const token = existing.trim();
            if (token.startsWith('mblk_')) {
                return token;
            }
        } catch {
            // Fall back to the memory-cached token if file read fails
        }
        return this.config.authToken;
    }

    private json(data: unknown, status = 200) {
        return new Response(JSON.stringify(data), {
            status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'X-API-Version': API_VERSION,
            }
        });
    }

    private error(status: number, message: string) {
        return this.json({ error: message, status }, status);
    }

    async start(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        
        // Setup initial watchers for existing blocks
        this.initWatchers().catch(console.error);

        this.server = Bun.serve({
            port: this.config.port,
            async fetch(req: Request, server: Server<WsData>) {
                // CORS preflight
                if (req.method === 'OPTIONS') {
                    return new Response(null, {
                        status: 204,
                        headers: {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                        }
                    });
                }

                const url = new URL(req.url);
                const path = url.pathname;

                // Plugin actions: /api/plugins/*
        if (path.startsWith('/api/plugins')) {
            const pluginMatch = path.match(/^\/api\/plugins(?:\/([^/]+)\/(install|uninstall|settings))?$/);
            if (pluginMatch) {
                if (req.method === 'GET' && !pluginMatch[1]) {
                    return await self.handleGetPlugins();
                }
                if (req.method === 'POST' && pluginMatch[2] === 'install') {
                    return await self.handleInstallPlugin(pluginMatch[1]);
                }
                if (req.method === 'DELETE' && pluginMatch[2] === 'uninstall') {
                    return await self.handleUninstallPlugin(pluginMatch[1]);
                }
                if (req.method === 'POST' && pluginMatch[2] === 'settings') {
                    return await self.handlePluginSettings(pluginMatch[1], req);
                }
            }
        }

        // WebSocket Upgrade
                if (path === '/api/ws') {
                    const token = self.extractToken(req);
                    const currentToken = await self.getDynamicToken();
                    if (!token || !validateAuthToken(token, currentToken)) {
                        return self.error(401, 'Unauthorized');
                    }
                    if (server.upgrade(req, { data: {} })) {
                        return undefined as unknown as Response; // Bun expects void-like return
                    }
                    return self.error(500, 'WebSocket upgrade failed');
                }

                // Auth check for API routes
                if (path.startsWith('/api/') && path !== '/api/health' && path !== '/api/auth/status') {
                    const token = self.extractToken(req);
                    const currentToken = await self.getDynamicToken();
                    if (!token || !validateAuthToken(token, currentToken)) {
                        return self.error(401, 'Unauthorized');
                    }
                }

                // API Routes
                try {
                    const response = await self.routeRequest(req, url, path);
                    if (response) return response;
                } catch (err) {
                    return self.error(500, `Internal error: ${(err as Error).message}`);
                }

                // Static Web UI Serving
                if (self.config.webRoot && req.method === 'GET') {
                    return await self.serveStatic(path);
                }

                return self.error(404, `Not found: ${path}`);
            },
            websocket: {
                open(_ws: ServerWebSocket<WsData>) {
                    // client connected
                },
                message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
                    try {
                        const msg = JSON.parse(typeof message === 'string' ? message : message.toString()) as {
                            type?: string;
                            block?: string;
                        };
                        if (msg.type === 'subscribe' && msg.block) {
                            ws.data = { ...ws.data, block: msg.block };
                            if (!self.subscribers.has(msg.block)) {
                                self.subscribers.set(msg.block, new Set());
                            }
                            self.subscribers.get(msg.block)!.add(ws);
                            
                            // Send initial refresh tick
                            ws.send(JSON.stringify({ type: 'refresh' }));
                        }
                    } catch (err) {
                        console.error('WebSocket message error:', err);
                    }
                },
                close(ws: ServerWebSocket<WsData>) {
                    const block = ws.data?.block;
                    if (block && self.subscribers.has(block)) {
                        self.subscribers.get(block)!.delete(ws);
                    }
                }
            }
        });
    }

    /** Route an API request to the correct handler. Returns null if no route matched. */
    private async routeRequest(req: Request, url: URL, path: string): Promise<Response | null> {
        if (req.method === 'GET' && path === '/api/health') {
            return this.json({ status: 'ok', version: API_VERSION });
        }

        if (req.method === 'GET' && path === '/api/auth/status') {
            const token = this.extractToken(req);
            const valid = token ? validateAuthToken(token, this.config.authToken) : false;
            return this.json({ authenticated: valid });
        }

        if (req.method === 'GET' && path === '/api/blocks') {
            return await this.handleGetBlocks();
        }

        // POST /api/blocks — create a new block
        if (req.method === 'POST' && path === '/api/blocks') {
            return await this.handleCreateBlock(req);
        }

        // GET /api/channels — list available channels
        if (req.method === 'GET' && path === '/api/channels') {
            return await this.handleGetChannels();
        }

        // Global Config routes
        if (path === '/api/config') {
            if (req.method === 'GET') return await this.handleGetGlobalConfig();
            if (req.method === 'POST') return await this.handleUpdateGlobalConfig(req);
        }

        // Single-block routes: /api/blocks/:name
        const blockMatch = path.match(/^\/api\/blocks\/([^/]+)$/);
        if (blockMatch) {
            if (req.method === 'GET') return await this.handleGetBlockDetails(blockMatch[1]);
            if (req.method === 'DELETE') return await this.handleDeleteBlock(blockMatch[1]);
        }

        // Block actions: /api/blocks/:name/:action
        const actionMatch = path.match(/^\/api\/blocks\/([^/]+)\/(\w+)$/);
        if (actionMatch && req.method === 'POST') {
            const [, blockName, action] = actionMatch;
            switch (action) {
                case 'start': return await this.handleStartBlock(blockName);
                case 'stop': return await this.handleStopBlock(blockName);
                case 'reset': return await this.handleResetBlock(blockName, url);
                case 'chat': return await this.handleChat(blockName, req);
                case 'stream': return await this.handleStream(blockName, req);
                default: break;
            }
        }

        if (actionMatch && req.method === 'GET' && actionMatch[2] === 'chat') {
            const channel = url.searchParams.get('channel') || 'web';
            return await this.handleGetChatLogs(actionMatch[1], channel);
        }

        // Block config: /api/blocks/:name/config
        const configMatch = path.match(/^\/api\/blocks\/([^/]+)\/config$/);
        if (configMatch) {
            if (req.method === 'GET') return await this.handleGetBlockConfig(configMatch[1]);
            if (req.method === 'PUT') return await this.handleUpdateBlockConfig(configMatch[1], req);
        }

        // Block logs: /api/blocks/:name/logs
        const logsMatch = path.match(/^\/api\/blocks\/([^/]+)\/logs$/);
        if (req.method === 'GET' && logsMatch) {
            return await this.handleGetBlockLogs(logsMatch[1]);
        }

        // Archive routes
        if (req.method === 'GET' && path === '/api/archive') {
            return await this.handleGetArchive();
        }

        const restoreMatch = path.match(/^\/api\/archive\/([^/]+)\/restore$/);
        if (req.method === 'POST' && restoreMatch) {
            return await this.handleRestoreArchive(restoreMatch[1]);
        }

        const archiveDeleteMatch = path.match(/^\/api\/archive\/([^/]+)$/);
        if (req.method === 'DELETE' && archiveDeleteMatch) {
            return await this.handleDeleteArchive(archiveDeleteMatch[1]);
        }

        return null;
    }

    async stop(): Promise<void> {
        if (this.server) {
            this.server.stop();
        }
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
    }

    // ===== Watchers for WebSocket Publishing =====

    private async initWatchers() {
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const { readdir } = await import('node:fs/promises');
            const entries = await readdir(blocksDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    this.watchBlock(entry.name);
                }
            }
        } catch { /* ignore */ }
    }

    private async watchBlock(blockName: string) {
        if (this.watchers.has(blockName)) return;

        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), blockName);
            
            // Debounce to prevent flood of websocket messages
            let timeout: ReturnType<typeof setTimeout> | null = null;
            const watcher = watch(blockPath, { recursive: true }, (_eventType, filename) => {
                if (filename && (filename.endsWith('.json') || filename.endsWith('.md') || filename.endsWith('.txt'))) {
                    if (timeout) clearTimeout(timeout);
                    timeout = setTimeout(() => {
                        this.notifySubscribers(blockName);
                    }, 100);
                }
            });
            this.watchers.set(blockName, watcher);
        } catch { /* ignore */ }
    }

    private notifySubscribers(blockName: string) {
        const subs = this.subscribers.get(blockName);
        if (!subs || subs.size === 0) return;
        
        const payload = JSON.stringify({ type: 'refresh' });
        for (const ws of subs) {
            try {
                ws.send(payload);
            } catch { /* ignore */ }
        }
    }

    // ===== API Handlers =====

    private async handleGetBlocks(): Promise<Response> {
        const globalConfig = await loadGlobalConfig();
        const blocksDir = resolveBlocksDir(globalConfig);
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(blocksDir, { withFileTypes: true });
        const blocks = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            try {
                const blockPath = join(blocksDir, entry.name);
                const config = await loadBlockConfig(blockPath);
                
                let pulse: Record<string, unknown> = { status: 'SLEEPING' };
                try { pulse = JSON.parse(await readFile(join(blockPath, 'pulse.json'), 'utf-8')); } catch { /* ignore */ }

                let costs: Record<string, unknown> = { totalCost: 0, totalInput: 0, totalOutput: 0 };
                try { costs = JSON.parse(await readFile(join(blockPath, 'costs.json'), 'utf-8')); } catch { /* ignore */ }

                blocks.push({
                    name: config.name,
                    description: config.description,
                    monitorName: config.monitorName || null,
                    monitorEmoji: config.monitorEmoji || null,
                    adapter: {
                        provider: config.adapter.provider,
                        model: config.adapter.model,
                    },
                    channel: config.channel.type,
                    pulse,
                    costs,
                });
            } catch { /* ignore */ }
        }
        return this.json({ blocks });
    }

    private async handleGetBlockDetails(name: string): Promise<Response> {
        const globalConfig = await loadGlobalConfig();
        const blockPath = join(resolveBlocksDir(globalConfig), name);
        const config = await loadBlockConfig(blockPath);

        let memory = '';
        try { memory = await readFile(join(blockPath, 'memory.md'), 'utf-8'); } catch { /* ignore */ }

        let monitor = '';
        try { monitor = await readFile(join(blockPath, 'monitor.md'), 'utf-8'); } catch { /* ignore */ }

        let costs: Record<string, unknown> = {};
        try { costs = JSON.parse(await readFile(join(blockPath, 'costs.json'), 'utf-8')); } catch { /* ignore */ }

        let pulse: Record<string, unknown> = {};
        try { pulse = JSON.parse(await readFile(join(blockPath, 'pulse.json'), 'utf-8')); } catch { /* ignore */ }

        return this.json({ config, memory, monitor, costs, pulse });
    }

    private async handleCreateBlock(req: Request): Promise<Response> {
        try {
            const body = await req.json() as { name: string; description?: string };
            const CREATE_PKG = '../../core/src/cli/commands/create.js';
            const { createCommand } = await import(CREATE_PKG);
            await createCommand(body.name);
            return this.json({ success: true, name: body.name });
        } catch (err) {
            return this.error(400, `Create failed: ${(err as Error).message}`);
        }
    }

    private async handleDeleteBlock(name: string): Promise<Response> {
        try {
            const DELETE_PKG = '../../core/src/cli/commands/delete.js';
            const { deleteCommand } = await import(DELETE_PKG);
            await deleteCommand(name);
            return this.json({ success: true, message: 'Archived safely.' });
        } catch (err) {
            return this.error(500, `Archive failed: ${(err as Error).message}`);
        }
    }

    private async handleStartBlock(blockName: string): Promise<Response> {
        try {
            // Pre-check: block must have a model configured before daemon spawn
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), blockName);
            const config = await loadBlockConfig(blockPath);

            if (!config.adapter?.model) {
                return this.error(400,
                    `Block "${blockName}" has no model configured. ` +
                    `Run \`mblk start ${blockName}\` in a terminal to complete setup.`
                );
            }

            const START_PKG = '../../core/src/cli/commands/start.js';
            const { startCommand } = await import(START_PKG);
            // Explicitly pass 'web' so WebChannel initializes and monitors chat.json
            await startCommand(blockName, { channel: 'web', daemon: true });
            return this.json({ success: true, message: `${blockName} started in daemon mode.` });
        } catch (err) {
            return this.error(500, `Start failed: ${(err as Error).message}`);
        }
    }

    private async handleStopBlock(blockName: string): Promise<Response> {
        try {
            const STOP_PKG = '../../core/src/cli/commands/stop.js';
            const { stopCommand } = await import(STOP_PKG);
            await stopCommand(blockName);
            return this.json({ success: true, message: `${blockName} stopped.` });
        } catch (err) {
            return this.error(500, `Stop failed: ${(err as Error).message}`);
        }
    }

    private async handleResetBlock(blockName: string, url: URL): Promise<Response> {
        try {
            const hard = url.searchParams.get('hard') === 'true';
            const RESET_PKG = '../../core/src/cli/commands/reset.js';
            const { resetCommand } = await import(RESET_PKG);
            await resetCommand(blockName, { hard });
            return this.json({ success: true, message: `${blockName} reset${hard ? ' (hard)' : ''}.` });
        } catch (err) {
            return this.error(500, `Reset failed: ${(err as Error).message}`);
        }
    }

    /**
     * POST /api/blocks/:name/chat — serialize a user message to chat.json.
     * Uses atomic write (temp file + rename) to prevent the daemon from reading
     * a half-written file.
     */
    private async handleChat(blockName: string, req: Request): Promise<Response> {
        try {
            const body = await req.json() as { message: string };
            if (!body.message || typeof body.message !== 'string') {
                return this.error(400, 'Missing or invalid "message" field.');
            }

            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), blockName);

            // Pre-check: block must have a model for the daemon to process messages
            const config = await loadBlockConfig(blockPath);
            if (!config.adapter?.model) {
                return this.error(400,
                    `Block "${blockName}" has no model configured. ` +
                    `Run \`mblk start ${blockName}\` in a terminal to complete setup.`
                );
            }

            const chatFile = join(blockPath, 'chat.json');
            
            let msgs: any[] = [];
            try {
                const raw = await readFile(chatFile, 'utf8');
                msgs = JSON.parse(raw);
            } catch { /* new file */ }

            msgs.push({
                role: 'user',
                content: body.message,
                timestamp: new Date().toISOString(),
                processed: false
            });

            // Atomic write: write to temp file then rename to prevent
            // the daemon reading a half-written chat.json
            const { writeFile: fsWriteFile, rename: fsRename } = await import('node:fs/promises');
            const tmpFile = chatFile + '.tmp';
            await fsWriteFile(tmpFile, JSON.stringify(msgs, null, 4), 'utf8');
            await fsRename(tmpFile, chatFile);

            // Check if a daemon is already running for this block
            let daemonRunning = false;
            let note = '';
            try {
                const lockFile = join(blockPath, '.lock');
                const pidStr = await readFile(lockFile, 'utf8');
                const pid = parseInt(pidStr.trim(), 10);
                if (pid && !isNaN(pid)) {
                    try {
                        process.kill(pid, 0); // signal 0 = check if alive
                        daemonRunning = true;
                    } catch {
                        // Dead PID — stale lock
                    }
                }
            } catch {
                // No lock file
            }

            if (!daemonRunning) {
                // Auto-start daemon for this block
                try {
                    const START_PKG = '../../core/src/cli/commands/start.js';
                    const { startCommand } = await import(START_PKG);
                    await startCommand(blockName, { channel: 'web', daemon: true });
                    note = 'Message queued. Block daemon starting up — first response may take a moment.';
                } catch (startErr) {
                    note = `Message queued, but daemon failed to start: ${(startErr as Error).message}`;
                }
            } else {
                note = '';
            }

            // Ensure we have a file watcher for this block
            this.watchBlock(blockName);

            return this.json({ queued: true, block: blockName, note });
        } catch (err) {
            return this.error(400, `Chat failed: ${(err as Error).message}`);
        }
    }

    private async handleStream(blockName: string, req: Request): Promise<Response> {
        try {
            const body = await req.json() as { chunk?: string };
            if (body.chunk) {
                const subs = this.subscribers.get(blockName);
                if (subs && subs.size > 0) {
                    const msg = JSON.stringify({ type: 'stream', chunk: body.chunk });
                    for (const ws of subs) {
                        try {
                            ws.send(msg);
                        } catch { /* ignore dropped conn */ }
                    }
                }
            }
            return this.json({ ok: true });
        } catch {
            return this.error(400, 'Invalid stream payload');
        }
    }

    private async handleGetPlugins(): Promise<Response> {
        try {
            const { PluginInstaller } = await import('@memoryblock/plugin-installer');
            const installer = new PluginInstaller();
            const plugins = await installer.listPlugins();

            const { join } = await import('node:path');
            const { readFile } = await import('node:fs/promises');
            let installed: Record<string, string> = {};
            try {
                const pkgRaw = await readFile(join(this.config.workspacePath, 'package.json'), 'utf8');
                installed = JSON.parse(pkgRaw).dependencies || {};
            } catch { /* ignore */ }

            const mapped = plugins.map((p: unknown) => {
                const plugin = p as any;
                return {
                    ...plugin,
                    installed: !!installed[plugin.package]
                };
            });

            // also merge settings
            for (const p of mapped) {
                if (p.settings) {
                    const saved = await installer.getPluginSettings(p.id, this.config.workspacePath);
                    for (const [key, field] of Object.entries(p.settings as Record<string, any>)) {
                        if (saved[key] !== undefined) {
                            field.default = saved[key];
                        }
                    }
                }
            }

            return this.json({ plugins: mapped });
        } catch (err: unknown) {
            return this.error(500, (err as Error).message);
        }
    }

    private async handleInstallPlugin(pluginId: string): Promise<Response> {
        const { PluginInstaller } = await import('@memoryblock/plugin-installer');
        const installer = new PluginInstaller();

        let controller: ReadableStreamDefaultController | undefined;
        const stream = new ReadableStream({
            start(c) {
                controller = c;
            }
        });

        installer.install(pluginId, {
            cwd: this.config.workspacePath,
            onLog: (chunk) => {
                if (controller) controller.enqueue(new TextEncoder().encode(chunk));
            }
        }).then(res => {
            if (controller) {
                controller.enqueue(new TextEncoder().encode(`\n__RESULT__${JSON.stringify({ success: res.success, message: res.message })}`));
                controller.close();
            }
        }).catch(err => {
            if (controller) {
                controller.enqueue(new TextEncoder().encode(`\n__RESULT__${JSON.stringify({ success: false, message: err.message })}`));
                controller.close();
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    private async handleUninstallPlugin(pluginId: string): Promise<Response> {
        const { PluginInstaller } = await import('@memoryblock/plugin-installer');
        const installer = new PluginInstaller();

        let controller: ReadableStreamDefaultController | undefined;
        const stream = new ReadableStream({
            start(c) {
                controller = c;
            }
        });

        installer.remove(pluginId, {
            cwd: this.config.workspacePath,
            onLog: (chunk) => {
                if (controller) controller.enqueue(new TextEncoder().encode(chunk));
            }
        }).then(res => {
            if (controller) {
                controller.enqueue(new TextEncoder().encode(`\n__RESULT__${JSON.stringify({ success: res.success, message: res.message })}`));
                controller.close();
            }
        }).catch(err => {
            if (controller) {
                controller.enqueue(new TextEncoder().encode(`\n__RESULT__${JSON.stringify({ success: false, message: err.message })}`));
                controller.close();
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    private async handlePluginSettings(pluginId: string, req: Request): Promise<Response> {
        try {
            const body = await req.json();
            const { PluginInstaller } = await import('@memoryblock/plugin-installer');
            const installer = new PluginInstaller();
            await installer.savePluginSettings(pluginId, body, this.config.workspacePath);
            return this.json({ success: true });
        } catch (err: unknown) {
            return this.error(400, (err as Error).message);
        }
    }

    private async handleGetChatLogs(blockName: string, channel: string = 'web'): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), blockName);

            if (channel === 'web') {
                // Web channel uses chat.json
                const chatFile = join(blockPath, 'chat.json');
                try {
                    const raw = await readFile(chatFile, 'utf8');
                    return this.json({ messages: JSON.parse(raw) });
                } catch {
                    return this.json({ messages: [] });
                }
            }

            // For CLI and Telegram channels, extract from conversation logs
            try {
                const logsDir = join(blockPath, 'logs');
                const { readdir } = await import('node:fs/promises');
                const files = await readdir(logsDir).catch(() => [] as string[]);

                // Match files: prefer new format (home-cli-*.txt) then old format (founder-monitor-*.txt)
                let logFiles = files
                    .filter(f => f.endsWith('.txt'))
                    .sort().reverse();

                // Prioritize files that contain the channel name or 'multi' in their filename
                const channelFiles = logFiles.filter(f =>
                    f.includes(`-${channel}-`) || 
                    f.includes(`${blockName}-${channel}`) ||
                    f.includes(`-multi-`)
                );
                if (channelFiles.length > 0) {
                    logFiles = channelFiles.slice(0, 5);
                } else {
                    logFiles = logFiles.slice(0, 5);
                }

                const messages: any[] = [];
                for (const file of logFiles) {
                    try {
                        const content = await readFile(join(logsDir, file), 'utf-8');
                        const lines = content.split('\n');
                        let currentRole = '';
                        let currentContent = '';
                        let currentTimestamp = '';
                        let currentChannelMatch = false;

                        for (const line of lines) {
                            // Actual log format: [2026-03-14 12:13:48] [CHANNEL:cli] [FROM:user]
                            // or: [2026-03-14 12:13:53] [CHANNEL:cli] [FROM:monitor:Ana] [EMOJI:🦊]
                            const headerMatch = line.match(
                                /^\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\]\s+\[CHANNEL:(\w+)\]\s+\[FROM:(user|monitor:\w+)\]/
                            );
                            // Also match system entries: [timestamp] [SYSTEM]
                            const systemMatch = !headerMatch && line.match(
                                /^\[(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})\]\s+\[SYSTEM\]/
                            );

                            if (headerMatch || systemMatch) {
                                // Flush previous message if it matched the requested channel
                                if (currentRole && currentContent && currentChannelMatch) {
                                    messages.push({
                                        role: currentRole.startsWith('monitor') ? 'assistant' : currentRole === 'system' ? 'system' : 'user',
                                        content: currentContent.trim(),
                                        timestamp: currentTimestamp,
                                        processed: true,
                                    });
                                }

                                if (headerMatch) {
                                    const [, ts, logChannel, from] = headerMatch;
                                    currentTimestamp = ts;
                                    currentRole = from.startsWith('monitor') ? 'monitor' : 'user';
                                    currentContent = '';
                                    currentChannelMatch = (logChannel === channel);
                                } else if (systemMatch) {
                                    const [, ts] = systemMatch;
                                    currentTimestamp = ts;
                                    currentRole = 'system';
                                    currentContent = '';
                                    currentChannelMatch = true; // System messages belong to all channels
                                }
                            } else if (currentRole && !line.startsWith('═')) {
                                // Content line (skip header/footer separators)
                                if (currentContent) {
                                    currentContent += '\n' + line;
                                } else {
                                    currentContent = line;
                                }
                            }
                        }

                        // Flush last message
                        if (currentRole && currentContent && currentChannelMatch) {
                            messages.push({
                                role: currentRole.startsWith('monitor') ? 'assistant' : currentRole === 'system' ? 'system' : 'user',
                                content: currentContent.trim(),
                                timestamp: currentTimestamp,
                                processed: true,
                            });
                        }
                    } catch { /* ignore individual file errors */ }
                }

                return this.json({ messages });
            } catch {
                return this.json({ messages: [] });
            }
        } catch (err) {
            return this.error(500, `Failed to load chat logs: ${(err as Error).message}`);
        }
    }

    /** GET /api/channels — list known channel types and their availability. */
    private async handleGetChannels(): Promise<Response> {
        const auth = await loadAuth();
        const channels = [
            { name: 'cli', status: 'active', description: 'Terminal interface' },
            {
                name: 'telegram',
                status: auth.telegram?.botToken ? 'configured' : 'unconfigured',
                description: 'Telegram bot via Grammy',
            },
            { name: 'web', status: 'planned', description: 'Browser-based chat UI' },
            { name: 'discord', status: 'planned', description: 'Discord bot' },
            { name: 'slack', status: 'planned', description: 'Slack bot' },
        ];
        return this.json({ channels });
    }

    private async handleGetGlobalConfig(): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            return this.json({ config: globalConfig });
        } catch (err) {
            return this.error(500, `Failed to load global config: ${(err as Error).message}`);
        }
    }

    private async handleUpdateGlobalConfig(req: Request): Promise<Response> {
        try {
            const updates = await req.json() as Record<string, unknown>;
            const globalConfig = await loadGlobalConfig();
            const merged = { ...globalConfig, ...updates };
            await saveGlobalConfig(merged as any);
            return this.json({ success: true, config: merged });
        } catch (err) {
            return this.error(500, `Failed to update global config: ${(err as Error).message}`);
        }
    }

    private async handleGetBlockLogs(name: string): Promise<Response> {
        const globalConfig = await loadGlobalConfig();
        const logsDir = join(resolveBlocksDir(globalConfig), name, 'logs');
        const { readdir } = await import('node:fs/promises');
        
        const files = await readdir(logsDir).catch(() => [] as string[]);
        const logs = files.filter(f => f.endsWith('.txt')).sort().reverse().slice(0, 20);

        const entries = [];
        for (const file of logs) {
            try {
                const content = await readFile(join(logsDir, file), 'utf-8');
                entries.push({ file, content });
            } catch { /* ignore */ }
        }

        return this.json({ logs: entries });
    }

    private async handleGetBlockConfig(name: string): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), name);
            const config = await loadBlockConfig(blockPath);
            return this.json({ config });
        } catch {
            return this.error(404, `Block "${name}" not found.`);
        }
    }

    private async handleUpdateBlockConfig(name: string, req: Request): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), name);
            const configPath = join(blockPath, 'config.json');

            // Read existing config
            const existing = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;

            // Merge with incoming updates (shallow merge at top level)
            const updates = await req.json() as Record<string, unknown>;
            const merged = { ...existing, ...updates };

            // Write back
            const { writeFile } = await import('node:fs/promises');
            await writeFile(configPath, JSON.stringify(merged, null, 4), 'utf-8');

            return this.json({ success: true, config: merged });
        } catch (err) {
            return this.error(500, `Config update failed: ${(err as Error).message}`);
        }
    }

    private async handleGetArchive(): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            const archiveDir = join(resolveBlocksDir(globalConfig), '_archive');
            const { readdir, stat: fsStat } = await import('node:fs/promises');

            let entries: string[] = [];
            try {
                const dirEntries = await readdir(archiveDir, { withFileTypes: true });
                entries = dirEntries.filter(e => e.isDirectory()).map(e => e.name);
            } catch {
                // Archive dir doesn't exist yet — that's fine
                return this.json({ archives: [] });
            }

            const archives = [];
            for (const entry of entries) {
                // Extract original block name from archive format: blockname_2024-01-01T12-00-00-000Z
                const match = entry.match(/^(.*?)_\d{4}-\d{2}-\d{2}T.*/);
                const originalName = match ? match[1] : entry;

                let archivedAt = '';
                try {
                    const stats = await fsStat(join(archiveDir, entry));
                    archivedAt = stats.mtime.toISOString();
                } catch { /* ignore */ }

                archives.push({
                    archiveName: entry,
                    originalName,
                    archivedAt,
                });
            }

            return this.json({ archives });
        } catch (err) {
            return this.error(500, `Archive list failed: ${(err as Error).message}`);
        }
    }

    private async handleRestoreArchive(archiveName: string): Promise<Response> {
        try {
            const RESTORE_PKG = '../../core/src/cli/commands/delete.js';
            const { restoreCommand } = await import(RESTORE_PKG);
            await restoreCommand(archiveName);
            return this.json({ success: true, message: `Restored from ${archiveName}.` });
        } catch (err) {
            return this.error(500, `Restore failed: ${(err as Error).message}`);
        }
    }

    private async handleDeleteArchive(archiveName: string): Promise<Response> {
        try {
            const DELETE_PKG = '../../core/src/cli/commands/delete.js';
            const { deleteCommand } = await import(DELETE_PKG);
            await deleteCommand(`_archive/${archiveName}`, { hard: true });
            return this.json({ success: true, message: 'Permanently deleted.' });
        } catch (err) {
            return this.error(500, `Delete failed: ${(err as Error).message}`);
        }
    }

    private async serveStatic(urlPath: string): Promise<Response> {
        const webRoot = this.config.webRoot!;
        const filePath = urlPath === '/' ? join(webRoot, 'index.html') : join(webRoot, urlPath);

        if (!filePath.startsWith(webRoot)) {
            return this.error(403, 'Forbidden');
        }

        try {
            const fileStat = await stat(filePath);
            if (!fileStat.isFile()) throw new Error();

            const ext = extname(filePath);
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            const content = await readFile(filePath);
            
            return new Response(new Uint8Array(content), {
                headers: { 'Content-Type': mime }
            });
        } catch {
            // Serve index.html for SPA fallback
            try {
                const indexContent = await readFile(join(webRoot, 'index.html'));
                return new Response(new Uint8Array(indexContent), {
                    headers: { 'Content-Type': 'text/html' }
                });
            } catch {
                return this.error(404, 'Not found');
            }
        }
    }
}