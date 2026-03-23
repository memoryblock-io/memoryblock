import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * Spawns a background daemon for a memoryblock.
 * Detaches the process and writes its PID to blockPath/daemon.pid
 */
export async function spawnDaemon(blockName: string, _channel: string, blockPath: string): Promise<number> {
    const scriptPath = process.argv[1];

    // Always use 'multi' so the daemon initializes ALL available channels
    // (web, telegram, etc.) and auto-routes messages via MultiChannelManager
    const child = spawn(process.execPath, [
        scriptPath, 'start', blockName, '--channel', 'multi'
    ], {
        detached: true,
        stdio: 'ignore', // Fully detached, no TTY hooks
        env: process.env // Preserve authentication keys
    });

    child.unref(); // Prevent parent from waiting for child

    if (child.pid) {
        await fsp.writeFile(join(blockPath, 'daemon.pid'), child.pid.toString());
        return child.pid;
    }
    throw new Error('Failed to spawn daemon process');
}

/**
 * Reads daemon.pid for a block and sends SIGTERM.
 */
export async function killDaemon(blockPath: string): Promise<boolean> {
    try {
        const pidPath = join(blockPath, 'daemon.pid');
        const pidStr = await fsp.readFile(pidPath, 'utf8');
        const pid = parseInt(pidStr.trim(), 10);
        
        if (pid && !isNaN(pid)) {
            try {
                process.kill(pid); // Send SIGTERM
            } catch (kErr: any) {
                // If ESRCH (No such process), process mapping is dead but file exists.
                if (kErr.code !== 'ESRCH') throw kErr;
            }
            await fsp.unlink(pidPath).catch(() => {});
            return true;
        }
    } catch {
        // PID file doesn't exist
    }
    return false;
}
