import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PulseState, PulseInstruction, BlockConfig } from '@memoryblock/types';
import { loadPulseState, savePulseState, getWsRoot } from '../utils/config.js';
import { log } from '../utils/logger.js';

const execAsync = promisify(exec);

/**
 * PulseEngine — The autonomic nervous system of a block.
 *
 * Runs a lightweight interval loop that processes pulse instructions
 * WITHOUT invoking the LLM. Only escalates to the monitor when an
 * instruction has `alertMonitor: true`.
 *
 * Brain analogy: Pulse handles autonomic rhythms, reflexes, background tasks.
 * The monitor (conscious brain) is only woken for decisions.
 */
export class PulseEngine {
    private blockPath: string;
    private blockName: string;
    private intervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private running = false;
    private _lastCronMinute = -1;
    private alertCallback: ((message: string) => Promise<void>) | null = null;

    constructor(blockPath: string, blockConfig: BlockConfig) {
        this.blockPath = blockPath;
        this.blockName = blockConfig.name;
        this.intervalMs = (blockConfig.pulse?.intervalSeconds || 30) * 1000;
    }

    /**
     * Register a callback for when a pulse instruction needs to alert the monitor.
     * This is the ONLY bridge between the pulse (autonomic) and the monitor (conscious).
     */
    onAlert(callback: (message: string) => Promise<void>): void {
        this.alertCallback = callback;
    }

    async start(): Promise<void> {
        this.running = true;
        // Migrate any legacy crons.json on first start
        await this.migrateLegacyCrons();
        // Run first pulse immediately, then on interval
        this.beat();
        this.timer = setInterval(() => this.beat(), this.intervalMs);
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Single pulse beat — the core loop iteration.
     * Reads pulse.json, processes each instruction, cleans expired ones.
     */
    private async beat(): Promise<void> {
        if (!this.running) return;

        try {
            const state = await loadPulseState(this.blockPath);
            const now = new Date();
            let dirty = false;

            // Clean expired instructions
            const before = state.instructions.length;
            state.instructions = state.instructions.filter(inst => {
                if (inst.expiresAt && new Date(inst.expiresAt) < now) return false;
                return true;
            });
            if (state.instructions.length < before) dirty = true;

            // Process each instruction
            for (const inst of state.instructions) {
                const shouldRun = this.shouldExecute(inst, now);
                if (!shouldRun) continue;

                try {
                    await this.executeInstruction(inst, now);
                    inst.lastExecuted = now.toISOString();
                    dirty = true;
                } catch (err) {
                    log.warn(`Pulse [${inst.id}]: ${(err as Error).message}`);
                }
            }

            // Update state
            if (dirty) {
                state.lastPulse = now.toISOString();
                await savePulseState(this.blockPath, state);
            }
        } catch {
            // pulse.json might not exist yet — that's fine
        }
    }

    /** Determine if an instruction should fire this beat. */
    private shouldExecute(inst: PulseInstruction, now: Date): boolean {
        if (inst.type === 'cron') {
            return this.matchesCron(inst, now);
        }

        // Interval-based: check if enough time has elapsed since last execution
        if (!inst.interval) return false;
        if (!inst.lastExecuted) return true; // never run before

        const elapsed = (now.getTime() - new Date(inst.lastExecuted).getTime()) / 1000;
        return elapsed >= inst.interval;
    }

    /** Check if a cron expression matches the current time. */
    private matchesCron(inst: PulseInstruction, now: Date): boolean {
        if (!inst.cronExpression) return false;
        const currentMinute = now.getMinutes();
        // Only check once per minute
        if (this._lastCronMinute === currentMinute) return false;

        const parts = inst.cronExpression.split(' ');
        if (parts.length !== 5) return false;
        const [min, hour, dom, mon, dow] = parts;

        const match = (val: string, current: number): boolean => {
            if (val === '*') return true;
            if (val.includes('/')) {
                const step = parseInt(val.split('/')[1], 10);
                return current % step === 0;
            }
            return parseInt(val, 10) === current;
        };

        const isMatch = match(min, now.getMinutes()) &&
            match(hour, now.getHours()) &&
            match(dom, now.getDate()) &&
            match(mon, now.getMonth() + 1) &&
            match(dow, now.getDay());

        if (isMatch) {
            this._lastCronMinute = currentMinute;
        }
        return isMatch;
    }

    /** Execute a single pulse instruction based on its type. */
    private async executeInstruction(inst: PulseInstruction, _now: Date): Promise<void> {
        switch (inst.type) {
            case 'script':
                await this.executeScript(inst);
                break;
            case 'log':
                await this.executeLog(inst);
                break;
            case 'webhook':
                await this.executeWebhook(inst);
                break;
            case 'alert':
                await this.executeAlert(inst);
                break;
            case 'cron':
                await this.executeCron(inst);
                break;
        }
    }

    /** Run a shell script silently. Optionally alert monitor with output. */
    private async executeScript(inst: PulseInstruction): Promise<void> {
        try {
            const { stdout, stderr } = await execAsync(inst.instruction, {
                timeout: 30_000,
                cwd: this.blockPath,
            });
            const output = (stdout || stderr || '').trim();

            if (inst.alertMonitor && this.alertCallback) {
                await this.alertCallback(`⚡ Pulse [${inst.id}] output:\n${output}`);
            }
        } catch (err) {
            if (inst.alertMonitor && this.alertCallback) {
                await this.alertCallback(`⚡ Pulse [${inst.id}] failed: ${(err as Error).message}`);
            }
        }
    }

    /** Write a formatted log entry. */
    private async executeLog(inst: PulseInstruction): Promise<void> {
        const logPath = join(this.blockPath, 'pulse.log');
        const entry = `[${new Date().toISOString()}] ${inst.id}: ${inst.instruction}\n`;
        await fsp.appendFile(logPath, entry, 'utf8');
    }

    /** Fire an HTTP request (health ping, webhook, etc). */
    private async executeWebhook(inst: PulseInstruction): Promise<void> {
        try {
            const res = await fetch(inst.instruction, { method: 'GET', signal: AbortSignal.timeout(10_000) });
            if (inst.alertMonitor && this.alertCallback) {
                await this.alertCallback(`🌐 Pulse [${inst.id}]: ${res.status} ${res.statusText}`);
            }
        } catch (err) {
            if (inst.alertMonitor && this.alertCallback) {
                await this.alertCallback(`🌐 Pulse [${inst.id}] failed: ${(err as Error).message}`);
            }
        }
    }

    /** Evaluate a condition and alert the monitor if it matches. */
    private async executeAlert(inst: PulseInstruction): Promise<void> {
        // Only meaningful with alertMonitor — otherwise it's a no-op
        if (!this.alertCallback) return;

        let conditionMet = true;
        if (inst.condition) {
            conditionMet = await this.evaluateCondition(inst.condition);
        }

        if (conditionMet) {
            await this.alertCallback(`🔔 Pulse Alert [${inst.id}]: ${inst.instruction}`);
        }
    }

    /** Cron-type instructions always wake the monitor with their instruction. */
    private async executeCron(inst: PulseInstruction): Promise<void> {
        log.system(this.blockName, `Pulse cron triggered: ${inst.id}`);
        if (this.alertCallback) {
            await this.alertCallback(`Timer elapsed: [${inst.id}]\nInstruction: ${inst.instruction}`);
        }
    }

    /** Evaluate simple system conditions (memory_percent, uptime, etc). */
    private async evaluateCondition(condition: string): Promise<boolean> {
        try {
            // Support: memory_percent > N
            const memMatch = condition.match(/memory_percent\s*([<>]=?|==)\s*(\d+)/);
            if (memMatch) {
                const [, op, val] = memMatch;
                const memInfo = process.memoryUsage();
                const totalMem = require('node:os').totalmem();
                const percent = (memInfo.rss / totalMem) * 100;
                const threshold = parseInt(val, 10);
                switch (op) {
                    case '>': return percent > threshold;
                    case '>=': return percent >= threshold;
                    case '<': return percent < threshold;
                    case '<=': return percent <= threshold;
                    case '==': return Math.round(percent) === threshold;
                }
            }

            // Support: uptime > N (seconds)
            const uptimeMatch = condition.match(/uptime\s*([<>]=?|==)\s*(\d+)/);
            if (uptimeMatch) {
                const [, op, val] = uptimeMatch;
                const uptime = process.uptime();
                const threshold = parseInt(val, 10);
                switch (op) {
                    case '>': return uptime > threshold;
                    case '>=': return uptime >= threshold;
                    case '<': return uptime < threshold;
                    case '<=': return uptime <= threshold;
                    case '==': return Math.round(uptime) === threshold;
                }
            }

            // Unknown condition — default to true (fire the alert)
            return true;
        } catch {
            return true;
        }
    }

    /**
     * Migrate legacy crons.json entries into pulse.json instructions.
     * Runs once on first start. Existing crons become type: 'cron' with alertMonitor: true.
     */
    private async migrateLegacyCrons(): Promise<void> {
        try {
            const cronsPath = join(getWsRoot(), 'crons.json');
            const data = await fsp.readFile(cronsPath, 'utf8');
            const crons = JSON.parse(data);
            const entries = Object.entries(crons);

            if (entries.length === 0) return;

            const state = await loadPulseState(this.blockPath);
            const existingIds = new Set(state.instructions.map(i => i.id));
            let migrated = 0;

            for (const [name, job] of entries) {
                const j = job as any;
                // Only migrate crons targeting this block
                if (j.target !== this.blockName) continue;
                if (existingIds.has(name)) continue;

                state.instructions.push({
                    id: name,
                    type: 'cron',
                    instruction: j.instruction,
                    cronExpression: j.cron_expression,
                    expiresAt: null,
                    alertMonitor: true,
                    lastExecuted: null,
                    createdAt: j.createdAt || new Date().toISOString(),
                });
                migrated++;
            }

            if (migrated > 0) {
                await savePulseState(this.blockPath, state);
                log.system(this.blockName, `Migrated ${migrated} legacy cron(s) to pulse`);
            }
        } catch {
            // No crons.json or read error — fine
        }
    }
}