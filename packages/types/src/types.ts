// ===== Block State =====
export type BlockStatus = 'SLEEPING' | 'ACTIVE' | 'BUSY' | 'ERROR';

/** A single autonomous pulse instruction — executes without waking the LLM unless alertMonitor is true. */
export type PulseInstructionType = 'script' | 'alert' | 'cron' | 'log' | 'webhook';

export interface PulseInstruction {
    id: string;
    type: PulseInstructionType;
    /** The instruction body: shell command (script), message (log/alert), URL (webhook), or LLM prompt (cron/alert). */
    instruction: string;
    /** Interval in seconds between executions (for script/alert/log/webhook types). */
    interval?: number;
    /** Cron expression (for cron type only). */
    cronExpression?: string;
    /** ISO timestamp after which this instruction is auto-cleaned. null = never expires. */
    expiresAt: string | null;
    /** If true, sends the result to the monitor (costs tokens). If false, runs silently. */
    alertMonitor: boolean;
    /** Optional condition expression for alert type (e.g., "memory_percent > 90"). */
    condition?: string;
    /** ISO timestamp of last execution. */
    lastExecuted: string | null;
    /** ISO timestamp of creation. */
    createdAt: string;
}

export interface PulseState {
    status: BlockStatus;
    lastRun: string | null;
    lastPulse: string | null;
    nextWakeUp: string | null;
    currentTask: string | null;
    error: string | null;
    instructions: PulseInstruction[];
}

// ===== Configuration =====
export interface AdapterConfig {
    provider: string;
    model: string;
    region: string;
    maxTokens: number;
    cacheControl: boolean;
    /** Optional API endpoint override. Used by Ollama (`http://localhost:11434/v1`) and any OpenAI-compatible base URL swap. */
    baseURL?: string;
}

export interface ToolsConfig {
    enabled: string[];
    searchProvider: string;
    sandbox: boolean;
    workingDir?: string;
}

export interface ChannelConfig {
    type: string;
    telegram?: {
        chatId: string;
    };
}

export interface MemoryConfig {
    maxContextTokens: number;
    thresholdPercent: number;
}

export interface PulseConfig {
    intervalSeconds: number;
}

export type PermissionScope = 'block' | 'workspace' | 'system';

export interface PermissionsConfig {
    scope: PermissionScope;
    allowShell: boolean;
    allowNetwork: boolean;
    maxTimeout: number;
}

export interface BlockConfig {
    name: string;
    description: string;
    adapter: AdapterConfig;
    goals: string[];
    tools: ToolsConfig;
    channel: ChannelConfig;
    memory: MemoryConfig;
    pulse: PulseConfig;
    permissions: PermissionsConfig;
    monitorName?: string;
    monitorEmoji?: string;
    /** Persistent flag — blocks with enabled:true auto-start on boot/restart */
    enabled?: boolean;
}

export interface GlobalConfig {
    language?: string;
    blocksDir: string;
    channelAlerts?: boolean;
    defaults: {
        adapter: AdapterConfig;
        memory: MemoryConfig;
        pulse: PulseConfig;
    };
}

/**
 * Per-provider auth shape. Each provider is keyed by its aiplug slug
 * (e.g. `minimax`, `openai`, `bedrock-aws`) and holds whatever credentials
 * that transport needs. Field names match aiplug's `configSchema(slug)`
 * output, so a new provider needs no schema change here — just add it to
 * aiplug's registry.
 */
export interface ProviderAuth {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    headers?: Record<string, string>;
    [k: string]: unknown;
}

export interface AuthConfig {
    /**
     * Generic per-provider credentials, indexed by aiplug slug. New
     * providers should write to this slot. Consumers should fall back to
     * the legacy `aws` / `openai` / `google` etc. fields below for
     * backward compatibility with auth.json files written before the
     * generic shape was introduced.
     */
    providers?: Record<string, ProviderAuth>;

    // Legacy fields — kept so existing auth.json files keep working.
    /** @deprecated use `auth.providers.bedrock` or `auth.providers.bedrock-aws`. */
    aws?: {
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
    };
    openai?: {
        apiKey: string;
    };
    google?: {
        apiKey: string;
    };
    /** @deprecated legacy alias for `google`. */
    gemini?: {
        apiKey: string;
    };
    anthropic?: {
        apiKey: string;
    };
    telegram?: {
        botToken: string;
        chatId?: string;
    };
    brave?: {
        apiKey: string;
    };
}

// ===== LLM Types =====
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResultMessage {
    toolCallId: string;
    name: string;
    content: string;
    isError?: boolean;
}

export interface LLMMessage {
    role: MessageRole;
    content?: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResultMessage[];
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export interface LLMResponse {
    message: LLMMessage;
    usage: TokenUsage;
    stopReason: StopReason;
}

// ===== Tool Types =====
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    requiresApproval: boolean;
    /** Minimum permission scope needed to use this tool. Defaults to 'block'. */
    requiredScope?: PermissionScope;
    /** If true, tool requires allowShell permission. */
    requiresShell?: boolean;
}

export interface ToolContext {
    blockPath: string;
    blockName: string;
    workingDir: string;
    workspacePath?: string;
    sandbox?: boolean;
    permissions?: PermissionsConfig;
    dispatchMessage?: (target: string, content: string) => Promise<void>;
}

export interface ToolExecutionResult {
    content: string;
    isError: boolean;
}

// ===== Channel Types =====
export interface ChannelMessage {
    blockName: string;
    monitorName: string;
    content: string;
    isSystem: boolean;
    timestamp: string;
    costReport?: string;
    sessionReport?: string;
    totalReport?: string;
    _sourceChannel?: string;
    _targetChannel?: string;
}

export interface ApprovalRequest {
    toolName: string;
    toolInput: Record<string, unknown>;
    description: string;
    toolDescription?: string;
    blockName: string;
    monitorName: string;
}

// ===== Contracts =====
export interface LLMAdapter {
    readonly provider: string;
    readonly model: string;
    converse(messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
    converseStream?(messages: LLMMessage[], tools?: ToolDefinition[], onChunk?: (text: string) => void): Promise<LLMResponse>;
}

export interface Channel {
    readonly name: string;
    send(message: ChannelMessage): Promise<void>;
    streamChunk?(chunk: string): Promise<void>;
    /** Prepare the channel for an incoming stream — print speaker header before first chunk. */
    prepareStream?(monitorName: string, blockName: string): void;
    onMessage(handler: (message: ChannelMessage) => void): void;
    requestApproval(request: ApprovalRequest): Promise<boolean>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getActiveChannels?(): string[];
}

export interface Tool {
    readonly definition: ToolDefinition;
    execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult>;
}

/**
 * Tool Registry interface — defined in core so the engine can use it
 * without a circular dependency on the tools package.
 */
export interface IToolRegistry {
    listTools(): ToolDefinition[];
    getDiscoveryTool(): ToolDefinition;
    execute(name: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult>;
}