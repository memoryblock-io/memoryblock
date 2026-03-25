import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { TokenUsage } from '@memoryblock/types';

/**
 * Pricing per 1M tokens (USD) — system-level, zero model tokens used.
 * Source: AWS Bedrock / Anthropic pricing pages.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    // Opus
    'us.anthropic.claude-opus-4-6-v1': { input: 15, output: 75 },
    'us.anthropic.claude-opus-4-20250514-v1:0': { input: 15, output: 75 },
    // Sonnet
    'us.anthropic.claude-sonnet-4-20250514-v1:0': { input: 3, output: 15 },
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3, output: 15 },
    // Haiku
    'us.anthropic.claude-3-5-haiku-20241022-v1:0': { input: 0.80, output: 4 },
};

const DEFAULT_PRICING = { input: 3, output: 15 };

interface CostSnapshot {
    sessionInput: number;
    sessionOutput: number;
    totalInput: number;
    totalOutput: number;
    sessionCost: number;
    totalCost: number;
    lastUpdated: string;
}

/**
 * System-level cost tracker — tracks tokens and calculates USD cost.
 * Persists to costs.json in the block directory.
 * No model tokens wasted — this is pure system bookkeeping.
 */
export class CostTracker {
    private model: string;
    private pricing: { input: number; output: number };
    private sessionInput = 0;
    private sessionOutput = 0;
    private totalInput = 0;
    private totalOutput = 0;
    private turnCount = 0;
    private lastTurnInput = 0;
    private lastTurnOutput = 0;
    private costFile: string;

    constructor(blockPath: string, model: string) {
        this.model = model;
        this.costFile = join(blockPath, 'costs.json');
        // Find pricing or use default
        this.pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
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

    /** Get session cost in USD. */
    getSessionCost(): number {
        return (this.sessionInput / 1_000_000) * this.pricing.input +
               (this.sessionOutput / 1_000_000) * this.pricing.output;
    }

    /** Get total cost in USD (all sessions). */
    getTotalCost(): number {
        return (this.totalInput / 1_000_000) * this.pricing.input +
               (this.totalOutput / 1_000_000) * this.pricing.output;
    }

    /** Format cost for display. */
    formatCost(cost: number): string {
        return `$${cost.toFixed(4)}`;
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
    getSnapshot(): CostSnapshot {
        return {
            sessionInput: this.sessionInput,
            sessionOutput: this.sessionOutput,
            totalInput: this.totalInput,
            totalOutput: this.totalOutput,
            sessionCost: this.getSessionCost(),
            totalCost: this.getTotalCost(),
            lastUpdated: new Date().toISOString(),
        };
    }

    /** Persist to costs.json. */
    async save(): Promise<void> {
        const snapshot = this.getSnapshot();
        await fsp.writeFile(this.costFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    }
}
