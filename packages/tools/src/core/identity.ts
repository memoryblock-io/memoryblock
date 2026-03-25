import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

// Resolve workspace root natively without pulling in core directly to avoid cycles
import { homedir } from 'node:os';
function getWsRoot(): string {
    const custom = process.env.MEMORYBLOCK_WS_DIR;
    return custom ? custom : join(homedir(), '.memoryblock', 'ws');
}

// ===== update_monitor_identity =====
export const updateMonitorIdentityTool: Tool = {
    definition: {
        name: 'update_monitor_identity',
        description: 'Update the monitor name and emoji for this block. This changes how you are identified in the system and UI.',
        parameters: createSchema(
            {
                name: { type: 'string', description: 'Your new chosen name (e.g. "Ana", "Nexus").' },
                emoji: { type: 'string', description: 'A single emoji representing your persona (e.g. "🤖", "🦊").' },
            },
            ['name', 'emoji'],
        ),
        requiresApproval: true,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        try {
            // 1. Update config.json
            const configPath = join(context.blockPath, 'config.json');
            const configRaw = await fsp.readFile(configPath, 'utf8');
            const config = JSON.parse(configRaw);
            
            config.monitorName = params.name;
            config.monitorEmoji = params.emoji;
            
            await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

            // 2. Update monitor.md to reflect the new identity explicitly
            const monitorPath = join(context.blockPath, 'monitor.md');
            let monitorContent = '';
            try {
                monitorContent = await fsp.readFile(monitorPath, 'utf8');
            } catch {
                // file doesn't exist yet, that's fine
            }

            const header = `# Identity\nName: ${params.name}\nEmoji: ${params.emoji}\n\n`;
            
            // Basic replacement logic if it already has an Identity header
            if (monitorContent.includes('# Identity')) {
                monitorContent = monitorContent.replace(/# Identity[\s\S]*?(?=\n#|$)/, header);
            } else {
                monitorContent = header + monitorContent;
            }

            await fsp.writeFile(monitorPath, monitorContent, 'utf8');

            return { 
                content: `Successfully updated monitor identity to ${params.emoji} ${params.name}. The system will reflect this change on the next interaction.`, 
                isError: false 
            };
        } catch (err) {
            return { content: `Failed to update monitor identity: ${(err as Error).message}`, isError: true };
        }
    },
};

// ===== update_founder_info =====
export const updateFounderInfoTool: Tool = {
    definition: {
        name: 'update_founder_info',
        description: 'Update the global founder profile. Use this when the user tells you about themselves (name, work, preferences). This data is globally shared across all your blocks.',
        parameters: createSchema(
            {
                info: { type: 'string', description: 'The new information to append or update about the founder.' },
                mode: { type: 'string', description: 'Either "append" (add new facts) or "rewrite" (completely rewrite the profile).' },
            },
            ['info', 'mode'],
        ),
        requiresApproval: false,
    },
    async execute(params, _context): Promise<ToolExecutionResult> {
        try {
            const wsRoot = getWsRoot();
            const founderPath = join(wsRoot, 'founder.md');
            
            let content = '';
            try {
                content = await fsp.readFile(founderPath, 'utf8');
            } catch {
                // file doesn't exist yet, that's fine
            }

            const newInfo = params.info as string;
            const mode = params.mode as string;

            if (mode === 'rewrite') {
                content = `# Founder Profile\n\n${newInfo}\n`;
            } else {
                // append intelligently
                if (!content.includes('# Founder Profile')) {
                    content = `# Founder Profile\n\n`;
                }
                const timestamp = new Date().toISOString().split('T')[0];
                content += `\n- [${timestamp}]: ${newInfo}`;
            }

            await fsp.writeFile(founderPath, content.trim() + '\n', 'utf8');

            return { 
                content: `Successfully updated global founder profile at ${founderPath}.`, 
                isError: false 
            };
        } catch (err) {
            return { content: `Failed to update founder profile: ${(err as Error).message}`, isError: true };
        }
    },
};

export const identityTools: Tool[] = [
    updateMonitorIdentityTool,
    updateFounderInfoTool,
];
