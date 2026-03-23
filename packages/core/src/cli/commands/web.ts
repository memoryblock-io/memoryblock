import {
    isInitialized,
} from '../../utils/config.js';
import { log } from '../logger.js';
import { DEFAULT_PORT } from '../constants.js';

const API_PKG = '@memoryblock/api';

export async function webCommand(options?: { port?: string; newToken?: boolean }): Promise<void> {
    if (!(await isInitialized())) {
        log.error('Not initialized. Run `mblk init` first.');
        process.exit(1);
    }

    const port = parseInt(options?.port || DEFAULT_PORT, 10);

    let api: any;
    try {
        api = await import(API_PKG);
    } catch (err) {
        log.error(`Failed to load API package: ${(err as Error).message}`);
        process.exit(1);
    }

    // Determine workspace path for token persistence
    const workspacePath = process.cwd();

    // Generate or reuse auth token
    const authToken = await api.generateAuthToken(workspacePath, options?.newToken);

    log.brand('web\n');
    log.dim(`  http://localhost:${port}`);
    log.dim(`  token: ${authToken}`);
    console.log('');

    // Resolve web UI static files path
    let webRoot: string | undefined;
    try {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const webPkg = require.resolve('@memoryblock/web/package.json');
        const { dirname, join } = await import('node:path');
        webRoot = join(dirname(webPkg), 'public');
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
        log.system('web', 'shutting down...');
        await server.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await server.start();
        log.dim('  api server running. ctrl+c to stop.');
    } catch (err) {
        log.error(`API server failed: ${(err as Error).message}`);
        process.exit(1);
    }

    // Keep alive
    await new Promise(() => {});
}
