import { z } from 'zod';

// ===== Adapter =====
export const AdapterConfigSchema = z.object({
    provider: z.string().default('bedrock'),
    model: z.string().default(''),
    region: z.string().default('us-east-1'),
    maxTokens: z.number().default(4096),
    cacheControl: z.boolean().default(false),
});

// ===== Tools =====
export const ToolsConfigSchema = z.object({
    enabled: z.array(z.string()).default([
        'read_file', 'write_file', 'list_directory',
        'create_directory', 'execute_command',
        'search_files', 'replace_in_file', 'file_info',
        'run_lint', 'run_build', 'run_test',
    ]),
    searchProvider: z.string().default('brave'),
    sandbox: z.boolean().default(true),
    workingDir: z.string().optional(),
});

// ===== Channel =====
export const ChannelConfigSchema = z.object({
    type: z.string().default('cli'),
    telegram: z.object({
        chatId: z.string(),
    }).optional(),
});

// ===== Memory =====
export const MemoryConfigSchema = z.object({
    maxContextTokens: z.number().default(100_000),
    thresholdPercent: z.number().min(50).max(95).default(80),
});

// ===== Pulse =====
export const PulseConfigSchema = z.object({
    intervalSeconds: z.number().min(5).default(30),
});

// ===== Permissions =====
export const PermissionsConfigSchema = z.object({
    scope: z.enum(['block', 'workspace', 'system']).default('block'),
    allowShell: z.boolean().default(false),
    allowNetwork: z.boolean().default(true),
    maxTimeout: z.number().default(120_000),
});

// ===== Block Config =====
export const BlockConfigSchema = z.object({
    name: z.string(),
    description: z.string().default(''),
    adapter: AdapterConfigSchema.default({}),
    goals: z.array(z.string()).default([]),
    tools: ToolsConfigSchema.default({}),
    channel: ChannelConfigSchema.default({}),
    memory: MemoryConfigSchema.default({}),
    pulse: PulseConfigSchema.default({}),
    permissions: PermissionsConfigSchema.default({}),
    // Monitor identity — set by the monitor during its first onboarding session
    monitorName: z.string().optional(),
    monitorEmoji: z.string().optional(),
    // Persistent state flag — blocks with enabled:true auto-start on boot/restart
    enabled: z.boolean().default(true),
});

// ===== Global Config =====
export const GlobalConfigSchema = z.object({
    language: z.string().default('en'),
    blocksDir: z.string().default('./blocks'),
    channelAlerts: z.boolean().default(true),
    defaults: z.object({
        adapter: AdapterConfigSchema.default({}),
        memory: MemoryConfigSchema.default({}),
        pulse: PulseConfigSchema.default({}),
    }).default({}),
});

// ===== Pulse Instruction =====
export const PulseInstructionSchema = z.object({
    id: z.string(),
    type: z.enum(['script', 'alert', 'cron', 'log', 'webhook']),
    instruction: z.string(),
    interval: z.number().optional(),
    cronExpression: z.string().optional(),
    expiresAt: z.string().nullable().default(null),
    alertMonitor: z.boolean().default(false),
    condition: z.string().optional(),
    lastExecuted: z.string().nullable().default(null),
    createdAt: z.string(),
});

// ===== Pulse State =====
export const PulseStateSchema = z.object({
    status: z.enum(['SLEEPING', 'ACTIVE', 'BUSY', 'ERROR']).default('SLEEPING'),
    lastRun: z.string().nullable().default(null),
    lastPulse: z.string().nullable().default(null),
    nextWakeUp: z.string().nullable().default(null),
    currentTask: z.string().nullable().default(null),
    error: z.string().nullable().default(null),
    instructions: z.array(PulseInstructionSchema).default([]),
});

// ===== Auth =====
export const AwsAuthSchema = z.object({
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    region: z.string().default('us-east-1'),
});

export const TelegramAuthSchema = z.object({
    botToken: z.string(),
    chatId: z.string().optional(),
});

export const BraveAuthSchema = z.object({
    apiKey: z.string(),
});

export const AnthropicAuthSchema = z.object({
    apiKey: z.string(),
});

export const OpenAIAuthSchema = z.object({
    apiKey: z.string(),
});

export const GeminiAuthSchema = z.object({
    apiKey: z.string(),
});

export const AuthConfigSchema = z.object({
    aws: AwsAuthSchema.optional(),
    anthropic: AnthropicAuthSchema.optional(),
    openai: OpenAIAuthSchema.optional(),
    gemini: GeminiAuthSchema.optional(),
    telegram: TelegramAuthSchema.optional(),
    brave: BraveAuthSchema.optional(),
});