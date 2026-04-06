import { join, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
    loadGlobalConfig, resolveBlocksDir,
    loadBlockConfig, loadAuth, saveGlobalConfig,
} from '@memoryblock/core';
import { validateAuthToken } from './auth.js';

// ─── Runtime Compatibility Layer ─────────────────────────────────────
// These helpers bridge node:http's IncomingMessage/ServerResponse with
// the Web API Response pattern used by our handlers.
// Works identically on both Node.js ≥20 and Bun.

/** Minimal request interface compatible with both Node.js and Bun runtimes. */
interface CompatRequest {
    readonly method: string;
    readonly url: string;
    readonly headers: { get(name: string): string | null };
    json(): Promise<any>;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function toCompatRequest(req: IncomingMessage, body: string): CompatRequest {
    const fullUrl = `http://${req.headers.host || 'localhost'}${req.url || '/'}`;
    return {
        method: req.method || 'GET',
        url: fullUrl,
        headers: {
            get(name: string): string | null {
                const val = req.headers[name.toLowerCase()];
                return Array.isArray(val) ? val[0] : val ?? null;
            }
        },
        async json() {
            return JSON.parse(body);
        }
    };
}

async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    res.writeHead(response.status, headers);
    if (response.body) {
        const reader = response.body.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
        } finally {
            res.end();
        }
    } else {
        res.end();
    }
}

// ─── Types & Constants ───────────────────────────────────────────────

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
 * Built-in HTTP & WebSocket Server.
 * Uses node:http + ws for universal runtime support (Node.js ≥20, Bun).
 * Zero framework dependencies.
 */
export class ApiServer {
    private server: ReturnType<typeof createServer> | null = null;
    private wss: WebSocketServer | null = null;
    private config: ApiServerConfig;
    // Map of blockName -> Set of WebSocket clients
    private subscribers: Map<string, Set<WebSocket>> = new Map();
    // Per-connection data (replaces Bun's ws.data pattern)
    private wsData: WeakMap<WebSocket, WsData> = new WeakMap();
    // Map of blockName -> fs.FSWatcher
    private watchers: Map<string, FSWatcher> = new Map();

    constructor(config: ApiServerConfig) {
        this.config = config;
    }

    private extractToken(req: CompatRequest): string | null {
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

    /** Simple semver comparison: is `a` newer than `b`? */
    private isNewer(a: string, b: string): boolean {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return true;
            if ((pa[i] || 0) < (pb[i] || 0)) return false;
        }
        return false;
    }

    async start(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        
        // Setup initial watchers for existing blocks
        this.initWatchers().catch(console.error);

        // ─── HTTP Server (node:http — works on Node.js and Bun) ──────
        this.server = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
            try {
                // Read body for non-GET/HEAD requests
                const body = (nodeReq.method === 'GET' || nodeReq.method === 'HEAD')
                    ? ''
                    : await readBody(nodeReq);

                const req = toCompatRequest(nodeReq, body);
                const url = new URL(req.url);
                const path = url.pathname;

                // CORS preflight
                if (req.method === 'OPTIONS') {
                    nodeRes.writeHead(204, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                    });
                    nodeRes.end();
                    return;
                }

                // Plugin actions: /api/plugins/*
                if (path.startsWith('/api/plugins')) {
                    const pluginMatch = path.match(/^\/api\/plugins(?:\/([^/]+)\/(install|uninstall|settings))?$/);
                    if (pluginMatch) {
                        let response: Response | null = null;
                        if (req.method === 'GET' && !pluginMatch[1]) {
                            response = await self.handleGetPlugins();
                        } else if (req.method === 'POST' && pluginMatch[2] === 'install') {
                            response = await self.handleInstallPlugin(pluginMatch[1]);
                        } else if (req.method === 'DELETE' && pluginMatch[2] === 'uninstall') {
                            response = await self.handleUninstallPlugin(pluginMatch[1]);
                        } else if (req.method === 'POST' && pluginMatch[2] === 'settings') {
                            response = await self.handlePluginSettings(pluginMatch[1], req);
                        }
                        if (response) {
                            await sendResponse(response, nodeRes);
                            return;
                        }
                    }
                }

                // Auth check for API routes
                if (path.startsWith('/api/') && path !== '/api/health' && path !== '/api/auth/status') {
                    const token = self.extractToken(req);
                    const currentToken = await self.getDynamicToken();
                    if (!token || !validateAuthToken(token, currentToken)) {
                        await sendResponse(self.error(401, 'Unauthorized'), nodeRes);
                        return;
                    }
                }

                // API Routes
                try {
                    const response = await self.routeRequest(req, url, path);
                    if (response) {
                        await sendResponse(response, nodeRes);
                        return;
                    }
                } catch (err) {
                    await sendResponse(self.error(500, `Internal error: ${(err as Error).message}`), nodeRes);
                    return;
                }

                // Static Web UI Serving
                if (self.config.webRoot && req.method === 'GET') {
                    await sendResponse(await self.serveStatic(path), nodeRes);
                    return;
                }

                await sendResponse(self.error(404, `Not found: ${path}`), nodeRes);
            } catch (err) {
                nodeRes.writeHead(500, { 'Content-Type': 'application/json' });
                nodeRes.end(JSON.stringify({ error: (err as Error).message }));
            }
        });

        // ─── WebSocket Server (ws package — works on Node.js and Bun) ──
        this.wss = new WebSocketServer({ noServer: true });

        this.server.on('upgrade', async (req: IncomingMessage, socket, head) => {
            const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            if (url.pathname !== '/api/ws') {
                socket.destroy();
                return;
            }

            // Auth check for WebSocket connections
            const auth = req.headers['authorization'];
            const token = auth?.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
            const currentToken = await self.getDynamicToken();
            if (!token || !validateAuthToken(token, currentToken)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            self.wss!.handleUpgrade(req, socket, head, (ws) => {
                self.wss!.emit('connection', ws);
            });
        });

        this.wss.on('connection', (ws: WebSocket) => {
            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(String(raw)) as { type?: string; block?: string };
                    if (msg.type === 'subscribe' && msg.block) {
                        self.wsData.set(ws, { block: msg.block });
                        if (!self.subscribers.has(msg.block)) {
                            self.subscribers.set(msg.block, new Set());
                        }
                        self.subscribers.get(msg.block)!.add(ws);

                        // Send initial refresh signal
                        ws.send(JSON.stringify({ type: 'refresh' }));
                    }
                } catch (err) {
                    console.error('WebSocket message error:', err);
                }
            });

            ws.on('close', () => {
                const data = self.wsData.get(ws);
                if (data?.block && self.subscribers.has(data.block)) {
                    self.subscribers.get(data.block)!.delete(ws);
                }
            });
        });

        // Start listening
        await new Promise<void>((resolve) => {
            this.server!.listen(this.config.port, () => resolve());
        });
    }

    /** Route an API request to the correct handler. Returns null if no route matched. */
    private async routeRequest(req: CompatRequest, url: URL, path: string): Promise<Response | null> {
        if (req.method === 'GET' && path === '/api/health') {
            return this.json({ status: 'ok', version: API_VERSION });
        }

        if (req.method === 'GET' && path === '/api/auth/status') {
            const token = this.extractToken(req);
            const valid = token ? validateAuthToken(token, this.config.authToken) : false;
            return this.json({ authenticated: valid });
        }

        // GET /api/version — check for updates (cached, non-blocking)
        if (req.method === 'GET' && path === '/api/version') {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                const res = await fetch('https://registry.npmjs.org/memoryblock/latest', {
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json' },
                });
                clearTimeout(timeout);
                if (res.ok) {
                    const data = await res.json() as { version: string };
                    return this.json({
                        current: API_VERSION,
                        latest: data.version,
                        updateAvailable: this.isNewer(data.version, API_VERSION),
                    });
                }
            } catch { /* network error */ }
            return this.json({ current: API_VERSION, latest: API_VERSION, updateAvailable: false });
        }

        // POST /api/update — full system update: install, graceful stop, restart
        if (req.method === 'POST' && path === '/api/update') {
            try {
                const { execSync, spawn } = await import('node:child_process');

                // 1. Install the new version globally (files on disk updated)
                // Dynamically detect which package manager originally installed memoryblock
                // based on the execution path to prevent split-brain global installations.
                let installCmd = 'npm install -g memoryblock 2>&1';
                const execPathStr = process.argv[1] || '';

                if (execPathStr.includes('.bun')) {
                    installCmd = 'bun install -g memoryblock 2>&1';
                } else if (execPathStr.includes('pnpm')) {
                    installCmd = 'pnpm add -g memoryblock 2>&1';
                } else if (execPathStr.includes('yarn')) {
                    installCmd = 'yarn global add memoryblock 2>&1';
                }

                const output = execSync(installCmd, {
                    timeout: 120_000,
                    encoding: 'utf-8',
                });

                // 2. Resolve the mblk binary for the restart script
                let mblkBin = 'mblk';
                try {
                    const which = process.platform === 'win32' ? 'where mblk' : 'which mblk';
                    mblkBin = execSync(which, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
                } catch { /* fallback to bare 'mblk' on PATH */ }

                // 3. Schedule full-system restart after the HTTP response is sent
                //    The detached child process outlives this server process.
                //    Sequence:
                //      a) Wait 2s for the response to flush
                //      b) `mblk shutdown` — gracefully stops all blocks (SIGTERM → they save
                //         memory.md, session.json, cost data) then stops the server
                //      c) Wait 3s for all processes to exit cleanly
                //      d) `mblk restart` — starts server + all previously-active blocks with NEW code
                setTimeout(() => {
                    try {
                        const isWin = process.platform === 'win32';
                        const shell = isWin ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';

                        const unixScript = [
                            `sleep 2`,
                            `"${mblkBin}" shutdown 2>/dev/null || true`,
                            `sleep 3`,
                            `"${mblkBin}" restart 2>/dev/null || true`,
                        ].join(' && ');

                        const winScript = [
                            `timeout /t 2 >nul`,
                            `"${mblkBin}" shutdown 2>nul`,
                            `timeout /t 3 >nul`,
                            `"${mblkBin}" restart 2>nul`,
                        ].join(' & ');

                        const child = spawn(shell, [isWin ? '/c' : '-c', isWin ? winScript : unixScript], {
                            detached: true,
                            stdio: 'ignore',
                            env: { ...process.env },
                        });
                        child.unref();
                    } catch {
                        // Last resort: bare exit — service manager picks it up
                    }
                    process.exit(0);
                }, 2000);

                return this.json({ success: true, output: output.trim() });
            } catch (err) {
                return this.json({
                    success: false,
                    error: (err as Error).message,
                }, 500);
            }
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
                case 'approve': return await this.handleApproval(blockName, 'approved');
                case 'deny': return await this.handleApproval(blockName, 'denied');
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
        if (this.wss) {
            this.wss.close();
        }
        if (this.server) {
            this.server.close();
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

    private async handleCreateBlock(req: CompatRequest): Promise<Response> {
        try {
            const body = await req.json() as { name: string; description?: string };
            const CREATE_PKG = 'memoryblock/commands';
            const { createCommand } = await import(CREATE_PKG);
            await createCommand(body.name);
            return this.json({ success: true, name: body.name });
        } catch (err) {
            return this.error(400, `Create failed: ${(err as Error).message}`);
        }
    }

    private async handleDeleteBlock(name: string): Promise<Response> {
        try {
            const DELETE_PKG = 'memoryblock/commands';
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

            const START_PKG = 'memoryblock/commands';
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
            const STOP_PKG = 'memoryblock/commands';
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
            const RESET_PKG = 'memoryblock/commands';
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
    private async handleChat(blockName: string, req: CompatRequest): Promise<Response> {
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
                    const START_PKG = 'memoryblock/commands';
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

    private async handleStream(blockName: string, req: CompatRequest): Promise<Response> {
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

    /**
     * POST /api/blocks/:name/approve or /api/blocks/:name/deny
     * Resolves a pending tool approval by writing the decision into approval_request.json.
     * The WebChannel's polling loop picks this up and unblocks the Monitor.
     */
    private async handleApproval(blockName: string, decision: 'approved' | 'denied'): Promise<Response> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blockPath = join(resolveBlocksDir(globalConfig), blockName);
            const approvalFile = join(blockPath, 'approval_request.json');

            try {
                const raw = await readFile(approvalFile, 'utf-8');
                const data = JSON.parse(raw);

                if (data.status !== 'pending') {
                    return this.error(409, `Approval already resolved: ${data.status}`);
                }

                data.status = decision;
                data.resolvedAt = new Date().toISOString();

                const { writeFile } = await import('node:fs/promises');
                await writeFile(approvalFile, JSON.stringify(data, null, 2), 'utf-8');

                // Broadcast resolution to WebSocket subscribers
                const subs = this.subscribers.get(blockName);
                if (subs && subs.size > 0) {
                    const msg = JSON.stringify({
                        type: 'approval_resolved',
                        decision,
                        toolName: data.toolName,
                    });
                    for (const ws of subs) {
                        try { ws.send(msg); } catch { /* ignore */ }
                    }
                }

                return this.json({
                    success: true,
                    message: `Tool "${data.toolName}" ${decision}.`,
                    decision,
                });
            } catch {
                return this.error(404, `No pending approval found for block "${blockName}".`);
            }
        } catch (err) {
            return this.error(500, `Approval failed: ${(err as Error).message}`);
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

    private async handlePluginSettings(pluginId: string, req: CompatRequest): Promise<Response> {
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

    private async handleUpdateGlobalConfig(req: CompatRequest): Promise<Response> {
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

    private async handleUpdateBlockConfig(name: string, req: CompatRequest): Promise<Response> {
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
            const RESTORE_PKG = 'memoryblock/commands';
            const { restoreCommand } = await import(RESTORE_PKG);
            await restoreCommand(archiveName);
            return this.json({ success: true, message: `Restored from ${archiveName}.` });
        } catch (err) {
            return this.error(500, `Restore failed: ${(err as Error).message}`);
        }
    }

    private async handleDeleteArchive(archiveName: string): Promise<Response> {
        try {
            const DELETE_PKG = 'memoryblock/commands';
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