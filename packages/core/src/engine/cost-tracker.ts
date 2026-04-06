import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { TokenUsage } from '@memoryblock/types';

interface TokenSnapshot {
    sessionInput: number;
    sessionOutput: number;
    totalInput: number;
    totalOutput: number;
    lastUpdated: string;
}

/**
 * System-level token tracker — tracks input/output token counts.
 * Persists to costs.json in the block directory.
 * No dollar estimates — providers report tokens natively and
 * pricing varies too much across providers/regions to be reliable.
 */
export class CostTracker {
    private sessionInput = 0;
    private sessionOutput = 0;
    private totalInput = 0;
    private totalOutput = 0;
    private turnCount = 0;
    private lastTurnInput = 0;
    private lastTurnOutput = 0;
    private costFile: string;

    constructor(blockPath: string, _model?: string) {
        this.costFile = join(blockPath, 'costs.json');
    }

    /** Load previous totals from costs.json. */
    async load(): Promise<void> {
        try {
            const raw = await fsp.readFile(this.costFile, 'utf-8');
            const data = JSON.parse(raw);
            this.totalInput = data.totalInput || 0;
            this.totalOutput = data.totalOutput || 0;
        } catch {
            // First run — no file
        }
    }

    /** Track a single API call's usage. */
    track(usage: TokenUsage): void {
        this.lastTurnInput = usage.inputTokens;
        this.lastTurnOutput = usage.outputTokens;
        this.sessionInput += usage.inputTokens;
        this.sessionOutput += usage.outputTokens;
        this.totalInput += usage.inputTokens;
        this.totalOutput += usage.outputTokens;
        this.turnCount++;
    }

    /** Get formatted session report. */
    getSessionReport(): string {
        return `${this.sessionInput.toLocaleString()} in / ${this.sessionOutput.toLocaleString()} out`;
    }

    /** Get per-turn report for the last API call. */
    getPerTurnReport(): string {
        return `${this.lastTurnInput.toLocaleString()} in / ${this.lastTurnOutput.toLocaleString()} out`;
    }

    /** Get all-time total report. */
    getTotalReport(): string {
        return `${this.totalInput.toLocaleString()} in / ${this.totalOutput.toLocaleString()} out`;
    }

    /** Get turn count. */
    getTurnCount(): number {
        return this.turnCount;
    }

    /** Get snapshot for display / persistence. */
    getSnapshot(): TokenSnapshot {
        return {
            sessionInput: this.sessionInput,
            sessionOutput: this.sessionOutput,
            totalInput: this.totalInput,
            totalOutput: this.totalOutput,
            lastUpdated: new Date().toISOString(),
        };
    }

    /** Persist to costs.json. */
    async save(): Promise<void> {
        const snapshot = this.getSnapshot();
        await fsp.writeFile(this.costFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    }
}