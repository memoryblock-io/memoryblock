import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname, platform, arch, cpus, totalmem, freemem, uptime, networkInterfaces } from 'node:os';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

function getWsRoot(): string {
    return process.env.MEMORYBLOCK_WS_DIR || join(homedir(), '.memoryblock', 'ws');
}

// ===== system_info =====
export const systemInfoTool: Tool = {
    definition: {
        name: 'system_info',
        description: 'Get system information: OS, CPU, memory, uptime, network. Useful for monitoring and diagnostics.',
        parameters: createSchema({}, []),
        requiresApproval: false,
    },
    async execute(_params, _context): Promise<ToolExecutionResult> {
        const mem = totalmem();
        const free = freemem();
        const used = mem - free;
        const nets = networkInterfaces();
        const ips: string[] = [];
        for (const [name, addrs] of Object.entries(nets)) {
            if (!addrs) continue;
            for (const addr of addrs) {
                if (!addr.internal && addr.family === 'IPv4') {
                    ips.push(`${name}: ${addr.address}`);
                }
            }
        }

        const info = [
            `Hostname: ${hostname()}`,
            `Platform: ${platform()} ${arch()}`,
            `CPUs: ${cpus().length}x ${cpus()[0]?.model || 'unknown'}`,
            `Memory: ${(used / 1024 ** 3).toFixed(1)}GB / ${(mem / 1024 ** 3).toFixed(1)}GB (${((used / mem) * 100).toFixed(0)}% used)`,
            `Free: ${(free / 1024 ** 3).toFixed(1)}GB`,
            `Uptime: ${(uptime() / 3600).toFixed(1)} hours`,
            `Node.js: ${process.version}`,
            `Runtime: ${'Bun' in globalThis ? 'Bun' : 'Node.js'}`,
            `Network: ${ips.length > 0 ? ips.join(', ') : 'no external interfaces'}`,
        ].join('\n');

        return { content: info, isError: false };
    },
};

// ===== list_blocks =====
export const listBlocksTool: Tool = {
    definition: {
        name: 'list_blocks',
        description: 'List all blocks in the memoryblock workspace with their status. Requires superblock.',
        parameters: createSchema({}, []),
        requiresApproval: false,
        requiredScope: 'system',
    },
    async execute(_params, _context): Promise<ToolExecutionResult> {
        try {
            const wsRoot = getWsRoot();
            const configPath = join(wsRoot, 'config.json');
            const configRaw = await fsp.readFile(configPath, 'utf-8');
            const config = JSON.parse(configRaw);
            const blocksDir = join(wsRoot, config.blocksDir || 'blocks');

            const entries = await fsp.readdir(blocksDir, { withFileTypes: true });
            const blocks: string[] = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const blockConfig = join(blocksDir, entry.name, 'config.json');
                try {
                    const raw = await fsp.readFile(blockConfig, 'utf-8');
                    const bc = JSON.parse(raw);
                    const status = bc.enabled ? '🟢 active' : '💤 sleeping';
                    const scope = bc.permissions?.scope || 'block';
                    blocks.push(`${bc.monitorEmoji || '⬡'} ${entry.name} — ${status} (scope: ${scope})`);
                } catch {
                    blocks.push(`⬡ ${entry.name} — ❓ no config`);
                }
            }

            return {
                content: blocks.length > 0 ? blocks.join('\n') : 'No blocks found.',
                isError: false,
            };
        } catch (err) {
            return { content: `Failed to list blocks: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== get_current_time =====
export const getCurrentTimeTool: Tool = {
    definition: {
        name: 'get_current_time',
        description: 'Get the current date, time, and timezone.',
        parameters: createSchema({}, []),
        requiresApproval: false,
    },
    async execute(): Promise<ToolExecutionResult> {
        const now = new Date();
        const info = [
            `UTC:   ${now.toISOString()}`,
            `Local: ${now.toString()}`,
            `Unix:  ${Math.floor(now.getTime() / 1000)}`,
        ].join('\n');
        return { content: info, isError: false };
    },
};

export const systemTools: Tool[] = [systemInfoTool, listBlocksTool, getCurrentTimeTool];