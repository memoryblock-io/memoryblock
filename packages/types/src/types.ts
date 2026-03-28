// ===== Block State =====
export type BlockStatus = 'SLEEPING' | 'ACTIVE' | 'BUSY' | 'ERROR';

export interface PulseState {
    status: BlockStatus;
    lastRun: string | null;
    nextWakeUp: string | null;
    currentTask: string | null;
    error: string | null;
}

// ===== Configuration =====
export interface AdapterConfig {
    provider: string;
    model: string;
    region: string;
    maxTokens: number;
    cacheControl: boolean;
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

export interface AuthConfig {
    aws?: {
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
    };
    openai?: {
        apiKey: string;
    };
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
    /** Internal: the channel that originated this message (set by MultiChannelManager). */
    _sourceChannel?: string;
    /** Internal: the channel to route this message to (set by sendToChannel). */
    _targetChannel?: string;
}

export interface ApprovalRequest {
    toolName: string;
    toolInput: Record<string, unknown>;
    description: string;
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