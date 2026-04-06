import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolExecutionResult, PulseInstruction } from '@memoryblock/types';
import { PulseStateSchema } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

function getBlockPath(blockName: string): string {
    const wsDir = process.env.MEMORYBLOCK_WS_DIR || join(homedir(), '.memoryblock', 'ws');
    return join(wsDir, 'blocks', blockName);
}

async function loadPulse(blockPath: string) {
    try {
        const raw = await fsp.readFile(join(blockPath, 'pulse.json'), 'utf8');
        return PulseStateSchema.parse(JSON.parse(raw));
    } catch {
        return PulseStateSchema.parse({});
    }
}

async function savePulse(blockPath: string, state: any) {
    await fsp.writeFile(join(blockPath, 'pulse.json'), JSON.stringify(state, null, 2), 'utf8');
}

// ───────────────────────────────────────────────────────────────
// set_pulse — Add or update a pulse instruction
// ───────────────────────────────────────────────────────────────
export const setPulseTool: Tool = {
    definition: {
        name: 'set_pulse',
        description: 'Set a pulse instruction — an autonomous, recurring task that runs without consuming tokens. Types: script (shell command), alert (condition-based monitor wake), cron (scheduled monitor wake), log (file logging), webhook (HTTP ping). Use alertMonitor:false for zero-token background tasks.',
        parameters: createSchema({
            id: { type: 'string', description: 'Unique identifier for this pulse instruction.' },
            type: { type: 'string', description: 'Instruction type: script | alert | cron | log | webhook' },
            instruction: { type: 'string', description: 'The instruction body: shell cmd (script), message (log/alert), URL (webhook), or prompt (cron).' },
            interval: { type: 'number', description: 'Seconds between executions (for script/alert/log/webhook). Omit for cron type.' },
            cron_expression: { type: 'string', description: 'Cron expression (for cron type only, e.g. "0 * * * *" for hourly).' },
            expires_in: { type: 'number', description: 'Optional: auto-expire after this many seconds. Omit for permanent.' },
            alert_monitor: { type: 'boolean', description: 'If true, sends result to monitor (costs tokens). Default: false for script/log/webhook, true for cron/alert.' },
            condition: { type: 'string', description: 'Condition expression for alert type (e.g., "memory_percent > 90").' },
        }, ['id', 'type', 'instruction']),
        requiresApproval: true,
    },
    async execute(params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        const {
            id, type, instruction, interval, cron_expression,
            expires_in, alert_monitor, condition,
        } = params as {
            id: string; type: string; instruction: string;
            interval?: number; cron_expression?: string;
            expires_in?: number; alert_monitor?: boolean; condition?: string;
        };

        const validTypes = ['script', 'alert', 'cron', 'log', 'webhook'];
        if (!validTypes.includes(type)) {
            return { content: `Invalid type "${type}". Must be one of: ${validTypes.join(', ')}`, isError: true };
        }

        if (type === 'cron' && !cron_expression) {
            return { content: 'Cron type requires a cron_expression.', isError: true };
        }
        if (type !== 'cron' && !interval) {
            return { content: `Type "${type}" requires an interval (seconds).`, isError: true };
        }

        const blockPath = context?.blockPath || getBlockPath(context?.blockName || 'home');
        const state = await loadPulse(blockPath);

        // Default alertMonitor based on type
        const shouldAlert = alert_monitor !== undefined
            ? alert_monitor
            : (type === 'cron' || type === 'alert');

        const expiresAt = expires_in
            ? new Date(Date.now() + expires_in * 1000).toISOString()
            : null;

        const newInstruction: PulseInstruction = {
            id,
            type: type as PulseInstruction['type'],
            instruction,
            interval: type !== 'cron' ? interval : undefined,
            cronExpression: type === 'cron' ? cron_expression : undefined,
            expiresAt,
            alertMonitor: shouldAlert,
            condition: type === 'alert' ? condition : undefined,
            lastExecuted: null,
            createdAt: new Date().toISOString(),
        };

        // Upsert: replace existing or add new
        const idx = state.instructions.findIndex((i: PulseInstruction) => i.id === id);
        if (idx >= 0) {
            state.instructions[idx] = newInstruction;
        } else {
            state.instructions.push(newInstruction);
        }

        await savePulse(blockPath, state);

        const tokenNote = shouldAlert ? '(will wake monitor — uses tokens)' : '(silent — zero tokens)';
        return {
            content: `Pulse [${id}] set: ${type} ${tokenNote}. ${interval ? `Every ${interval}s` : ``}${cron_expression ? `Cron: ${cron_expression}` : ''}${expiresAt ? `. Expires: ${expiresAt}` : ''}`,
            isError: false,
        };
    },
};

// ───────────────────────────────────────────────────────────────
// list_pulses — View all active pulse instructions
// ───────────────────────────────────────────────────────────────
export const listPulsesTool: Tool = {
    definition: {
        name: 'list_pulses',
        description: 'Lists all active pulse instructions for this block, including their type, interval, expiry, and whether they alert the monitor.',
        parameters: createSchema({}, []),
        requiresApproval: false,
    },
    async execute(_params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        const blockPath = context?.blockPath || getBlockPath(context?.blockName || 'home');
        const state = await loadPulse(blockPath);

        if (state.instructions.length === 0) {
            return { content: 'No active pulse instructions. Use set_pulse to create one.', isError: false };
        }

        const lines = state.instructions.map((inst: PulseInstruction) => {
            const timing = inst.type === 'cron'
                ? `cron: "${inst.cronExpression}"`
                : `every ${inst.interval}s`;
            const alert = inst.alertMonitor ? '🔔 alerts monitor' : '🔇 silent';
            const expiry = inst.expiresAt ? `expires: ${inst.expiresAt}` : 'permanent';
            const lastRun = inst.lastExecuted ? `last: ${inst.lastExecuted}` : 'never run';
            return `- **${inst.id}** [${inst.type}] ${timing} | ${alert} | ${expiry} | ${lastRun}\n  → ${inst.instruction}`;
        });

        return {
            content: `**Active Pulses (${state.instructions.length}):**\n\n${lines.join('\n\n')}`,
            isError: false,
        };
    },
};

// ───────────────────────────────────────────────────────────────
// remove_pulse — Remove a pulse instruction
// ───────────────────────────────────────────────────────────────
export const removePulseTool: Tool = {
    definition: {
        name: 'remove_pulse',
        description: 'Removes an active pulse instruction by its ID.',
        parameters: createSchema({
            id: { type: 'string', description: 'The ID of the pulse instruction to remove.' },
        }, ['id']),
        requiresApproval: true,
    },
    async execute(params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        const { id } = params as { id: string };
        const blockPath = context?.blockPath || getBlockPath(context?.blockName || 'home');
        const state = await loadPulse(blockPath);

        const idx = state.instructions.findIndex((i: PulseInstruction) => i.id === id);
        if (idx < 0) {
            return { content: `Pulse instruction '${id}' not found.`, isError: true };
        }

        state.instructions.splice(idx, 1);
        await savePulse(blockPath, state);

        return { content: `Pulse instruction '${id}' removed.`, isError: false };
    },
};

// ───────────────────────────────────────────────────────────────
// Legacy cron compatibility wrappers
// ───────────────────────────────────────────────────────────────
export const scheduleCronJobTool: Tool = {
    definition: {
        name: 'schedule_cron_job',
        description: 'Creates a scheduled cron job (powered by Pulse). Equivalent to set_pulse with type=cron and alertMonitor=true.',
        parameters: createSchema({
            name: { type: 'string', description: 'Unique identifier for the cron job' },
            cron_expression: { type: 'string', description: 'Standard cron expression (e.g., "0 * * * *" for hourly)' },
            instruction: { type: 'string', description: 'The text instruction to execute when the cron triggers.' },
            target: { type: 'string', description: 'The target block name.' },
        }, ['name', 'cron_expression', 'instruction', 'target']),
        requiresApproval: true,
    },
    async execute(params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        // Delegate to set_pulse
        return setPulseTool.execute({
            id: params.name,
            type: 'cron',
            instruction: params.instruction,
            cron_expression: params.cron_expression,
            alert_monitor: true,
        }, context);
    },
};

export const listCronJobsTool: Tool = {
    definition: {
        name: 'list_cron_jobs',
        description: 'Lists all active cron jobs (pulse instructions of type "cron").',
        parameters: createSchema({}, []),
        requiresApproval: false,
    },
    async execute(_params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        return listPulsesTool.execute({}, context);
    },
};

export const removeCronJobTool: Tool = {
    definition: {
        name: 'remove_cron_job',
        description: 'Removes an active cron job by name.',
        parameters: createSchema({
            name: { type: 'string', description: 'Unique identifier of the cron job' },
        }, ['name']),
        requiresApproval: true,
    },
    async execute(params: Record<string, unknown>, context): Promise<ToolExecutionResult> {
        return removePulseTool.execute({ id: params.name }, context);
    },
};

// Export grouped
export const pulseTools: Tool[] = [setPulseTool, listPulsesTool, removePulseTool];
export const cronTools: Tool[] = [scheduleCronJobTool, listCronJobsTool, removeCronJobTool];
