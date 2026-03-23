import {
    isInitialized, getHome,
} from '../../utils/config.js';
import { log } from '../logger.js';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { DEFAULT_PORT } from '../constants.js';

const API_PKG = '@memoryblock/api';

/**
 * Server lifecycle management.
 * Manages the web/API server as a foreground or daemon process.
 */

export async function serverStartCommand(options?: {
    port?: string;
    newToken?: boolean;
    daemon?: boolean;
}): Promise<void> {
    if (!(await isInitialized())) {
        log.error('Not initialized. Run `mblk init` first.');
        process.exit(1);
    }

    const port = parseInt(options?.port || DEFAULT_PORT, 10);

    // Check if server is already running (skip if stored PID is our own — we ARE the daemon child)
    const existingPid = await readServerPid();
    if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
        const existingPort = await readServerPort();
        log.warn(`Server already running (PID ${existingPid}${existingPort ? `, port ${existingPort}` : ''}).`);
        log.dim('  Use `mblk server stop` to stop it first.');
        return;
    }

    // Daemon mode — spawn detached and exit
    if (options?.daemon) {
        const { spawn } = await import('node:child_process');
        const fs = await import('node:fs');
        const scriptPath = process.argv[1];

        // Redirect daemon output to a log file for debugging crashes
        const logPath = join(getHome(), 'server.log');
        const logFd = fs.openSync(logPath, 'a');

        const child = spawn(process.execPath, [
            scriptPath, 'server', 'start', '--port', port.toString(),
            ...(options?.newToken ? ['--new-token'] : []),
        ], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
            env: process.env,
            cwd: process.cwd(),
        });

        child.unref();
        fs.closeSync(logFd);

        if (child.pid) {
            await writeServerPid(child.pid);
            await writeServerPort(port);
            log.brand('server\n');
            log.success(`  Server started as daemon (PID ${child.pid}).`);
            log.dim(`  http://localhost:${port}`);
            log.dim('  `mblk server stop` to shut down.\n');
        } else {
            log.error('Failed to spawn daemon process.');
            process.exit(1);
        }
        return;
    }

    // Foreground mode
    let api: any;
    try {
        api = await import(API_PKG);
    } catch (err) {
        log.error(`Failed to load API package: ${(err as Error).message}`);
        process.exit(1);
    }

    const workspacePath = process.cwd();
    const authToken = await api.generateAuthToken(workspacePath, options?.newToken);

    // Write PID + port for status/stop
    await writeServerPid(process.pid);
    await writeServerPort(port);

    log.brand('server\n');
    log.dim(`  http://localhost:${port}`);
    log.dim(`  token: ${authToken}`);
    console.log('');

    // Auto-install OS service hook quietly
    import('./service.js').then(s => s.silentServiceInstall()).catch(() => {});

    // Resolve web UI static files
    let webRoot: string | undefined;
    try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const webPkg = require.resolve('@memoryblock/web/package.json');
        const { dirname, join: pJoin } = await import('node:path');
        webRoot = pJoin(dirname(webPkg), 'public');
    } catch {
        log.warn('Web UI package not found. API-only mode.');
    }

    const server = new api.ApiServer({
        port,
        authToken,
        workspacePath,
        webRoot,
    });

    const shutdown = async () => {
        log.system('server', 'shutting down...');
        await server.stop();
        await cleanupServerFiles();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await server.start();
        log.dim('  server running. ctrl+c to stop.\n');
    } catch (err) {
        log.error(`Server failed: ${(err as Error).message}`);
        await cleanupServerFiles();
        process.exit(1);
    }

    // Keep alive
    await new Promise(() => {});
}

export async function serverStopCommand(): Promise<void> {
    const pid = await readServerPid();
    const port = await readServerPort();

    if (!pid) {
        // No PID file — try killing by port as a fallback
        if (port) {
            const killed = await killByPort(port);
            if (killed) {
                log.success(`  Server on port ${port} stopped (via port lookup).`);
            } else {
                log.dim('  No server PID found. Server may not be running.');
            }
        } else {
            // Last resort: try the default port
            const defaultPort = parseInt(DEFAULT_PORT, 10);
            const killed = await killByPort(defaultPort);
            if (killed) {
                log.success(`  Server on port ${DEFAULT_PORT} stopped (via port lookup).`);
            } else {
                log.dim('  No server PID found. Server may not be running.');
            }
        }
        await cleanupServerFiles();
        return;
    }

    if (!isProcessAlive(pid)) {
        log.dim('  Server process not found (stale PID). Cleaning up.');
        await cleanupServerFiles();
        return;
    }

    try {
        process.kill(pid, 'SIGTERM');
        log.success(`  Server stopped (PID ${pid}).`);
    } catch (err: any) {
        if (err.code === 'ESRCH') {
            log.dim('  Server process already gone. Cleaning up.');
        } else {
            log.error(`Failed to stop server: ${err.message}`);
        }
    }

    await cleanupServerFiles();
}

export async function serverStatusCommand(): Promise<void> {
    const pid = await readServerPid();
    const port = await readServerPort();

    log.brand('server status\n');

    if (!pid) {
        log.dim('  Status: not running');
        return;
    }

    if (isProcessAlive(pid)) {
        log.success(`  Status: running`);
        log.dim(`  PID:    ${pid}`);
        if (port) log.dim(`  URL:    http://localhost:${port}`);
    } else {
        log.dim('  Status: not running (stale PID file)');
        await cleanupServerFiles();
    }
    console.log('');
}

export async function serverTokenCommand(options?: { newToken?: boolean }): Promise<void> {
    log.brand(options?.newToken ? 'server token (new)\n' : 'server token\n');

    let api: any;
    try {
        api = await import(API_PKG);
    } catch (err) {
        log.error(`Failed to load API package: ${(err as Error).message}`);
        process.exit(1);
    }

    const workspacePath = process.cwd();
    const token = await api.generateAuthToken(workspacePath, options?.newToken);

    if (options?.newToken) {
        log.success(`  New token generated successfully.`);
    }
    log.dim(`  token: ${token}\n`);
}


// ===== PID / Port Helpers =====

function pidPath(): string { return join(getHome(), 'server.pid'); }
function portPath(): string { return join(getHome(), 'server.port'); }

async function writeServerPid(pid: number): Promise<void> {
    await fsp.mkdir(getHome(), { recursive: true });
    await fsp.writeFile(pidPath(), pid.toString());
}

async function writeServerPort(port: number): Promise<void> {
    await fsp.writeFile(portPath(), port.toString());
}

async function readServerPid(): Promise<number | null> {
    try {
        const s = await fsp.readFile(pidPath(), 'utf-8');
        const n = parseInt(s.trim(), 10);
        return isNaN(n) ? null : n;
    } catch { return null; }
}

async function readServerPort(): Promise<number | null> {
    try {
        const s = await fsp.readFile(portPath(), 'utf-8');
        const n = parseInt(s.trim(), 10);
        return isNaN(n) ? null : n;
    } catch { return null; }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0); // Signal 0 checks existence
        return true;
    } catch { return false; }
}

async function cleanupServerFiles(): Promise<void> {
    await fsp.unlink(pidPath()).catch(() => {});
    await fsp.unlink(portPath()).catch(() => {});
}

/** Kill process by port using lsof — fallback when PID file is missing. */
async function killByPort(port: number): Promise<boolean> {
    try {
        const { execSync } = await import('node:child_process');
        const pids = execSync(`lsof -ti:${port}`, { stdio: 'pipe' })
            .toString().trim().split('\n').filter(Boolean);
        for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch { /* already gone */ }
        }
        return pids.length > 0;
    } catch {
        return false;
    }
}

/**
 * mblk shutdown — stop all blocks AND the server in one shot.
 */
export async function shutdownCommand(): Promise<void> {
    log.brand('shutdown\n');

    // 1. Stop all blocks
    log.dim('  Stopping all blocks...');
    try {
        const { stopCommand } = await import('./stop.js');
        await stopCommand(undefined, { preserveEnabled: true });
    } catch { /* ignore */ }

    // 2. Stop the server
    log.dim('  Stopping server...');
    await serverStopCommand();

    log.success('\n  Everything shut down.');
}

/**
 * mblk restart — shutdown then start server as daemon.
 */
export async function restartCommand(options?: { port?: string }): Promise<void> {
    log.brand('restart\n');

    // Shutdown first
    await shutdownCommand();

    // Small delay to let PID files clean up
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start server as daemon
    log.dim('\n  Starting server...');
    await serverStartCommand({ port: options?.port, daemon: true });

    // Start all enabled blocks
    log.dim('\n  Starting enabled blocks...');
    const { startAllEnabledBlocks } = await import('./start.js');
    await startAllEnabledBlocks();
}