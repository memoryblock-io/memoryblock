import type {
    LLMAdapter, LLMMessage, ToolDefinition, Channel, BlockConfig, ChannelMessage,
    IToolRegistry,
} from '@memoryblock/types';
import { MemoryManager } from './memory.js';
import { Gatekeeper } from './gatekeeper.js';
import { ConversationLogger } from './conversation-log.js';
import { CostTracker } from './cost-tracker.js';
import { savePulseState, saveBlockConfig, loadGlobalConfig, resolveBlocksDir, getWsRoot } from '../utils/config.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { t } from '@memoryblock/locale';
import { SYSTEM_PROMPTS } from './prompts.js';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';


// Safe commands that skip approval — monitor can auto-execute these
const SAFE_PREFIXES = [
    'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'which', 'echo', 'pwd',
    'node --version', 'bun --version', 'pnpm --version', 'npm --version',
    'git status', 'git log', 'git diff', 'git branch',
    'tsc --noEmit', 'npx eslint', 'pnpm lint', 'npm run lint',
    'pnpm build', 'npm run build', 'pnpm test', 'npm test',
];

export interface MonitorConfig {
    blockPath: string;
    blockConfig: BlockConfig;
    adapter: LLMAdapter;
    registry: IToolRegistry;
    channel: Channel;
}

/**
 * The Monitor — a block's resident intelligence.
 *
 * Features:
 * - Identity (name, emoji, personality) persisted to monitor.md
 * - Conversation logging to logs/
 * - System-level token tracking (no model tokens wasted)
 * - Smart memory: saves only key context at threshold/stop
 * - Safe-command auto-execution (lint, build, test, grep — no approval needed)
 * - Sandbox toggle: sandbox=false gives full filesystem access
 */
export class Monitor {
    private memory: MemoryManager;
    private gatekeeper: Gatekeeper;
    private logger: ConversationLogger;
    private channel: Channel;
    private blockPath: string;
    private costTracker: CostTracker;
    private messages: LLMMessage[] = [];
    private running = false;
    private toolsDiscovered = false;
    private toolsUsedThisCycle = false; // Track when tools have been used after discovery
    private monitorName: string;
    private monitorEmoji: string;
    private blockConfig: BlockConfig;
    private adapter: LLMAdapter;
    private registry: IToolRegistry;
    private cronTimer: NodeJS.Timeout | null = null;
    private _lastCronMinute = -1;

    constructor(options: {
        blockPath: string;
        blockConfig: BlockConfig;
        adapter: LLMAdapter;
        registry: IToolRegistry;
        channel: Channel;
    }) {
        this.blockPath = options.blockPath;
        this.blockConfig = options.blockConfig;
        this.adapter = options.adapter;
        this.registry = options.registry;
        this.channel = options.channel;

        this.monitorName = options.blockConfig.monitorName || 'Monitor';
        this.monitorEmoji = options.blockConfig.monitorEmoji || '✨';
        this.memory = new MemoryManager(
            options.blockConfig.memory.maxContextTokens,
            options.blockConfig.memory.thresholdPercent,
        );
        this.gatekeeper = new Gatekeeper(
            options.channel,
            options.blockConfig.name,
            this.monitorName,
        );
        this.logger = new ConversationLogger(options.blockPath);
        this.costTracker = new CostTracker(options.blockPath, options.blockConfig.adapter.model);
    }

    async start(): Promise<void> {
        this.running = true;
        const { blockConfig, blockPath } = this;

        // Load previous token totals
        await this.costTracker.load();

        await savePulseState(blockPath, {
            status: 'ACTIVE',
            lastRun: new Date().toISOString(),
            nextWakeUp: null,
            currentTask: 'Online',
            error: null,
        });

        // founder.md lives at the workspace root (~/.memoryblock/ws/), shared across blocks
        const wsRoot = getWsRoot();
        const [monitorContent, memoryContent, founderContent] = await Promise.all([
            this.readFile(join(blockPath, 'monitor.md')),
            this.readFile(join(blockPath, 'memory.md')),
            this.readFile(join(wsRoot, 'founder.md')),
        ]);

        const isFirstRun = !blockConfig.monitorName;

        const systemPrompt = this.buildSystemPrompt(
            blockConfig, monitorContent, memoryContent, founderContent, isFirstRun,
        );
        // System prompt pushed ONCE at session start, never re-sent per message
        this.messages = [{ role: 'system', content: systemPrompt }];

        await this.logger.init(blockConfig.name, this.monitorName, this.channel.name);

        const displayName = `${this.monitorEmoji} ${this.monitorName}`;
        log.monitor(blockConfig.name, displayName, 'Online. Listening...');

        this.channel.onMessage(async (msg: ChannelMessage) => {
            if (!this.running) return;
            await this.handleUserMessage(msg.content, msg._sourceChannel);
        });

        await this.channel.start();

        // Start internal tick for cron polling (runs every 10 seconds, checks minute match)
        this.cronTimer = setInterval(() => this.tick(), 10000);
        this.tick();
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.cronTimer) clearInterval(this.cronTimer);

        // Save smart memory summary before shutdown
        await this.saveSmartMemory();

        // Persist token data
        await this.costTracker.save();

        await this.logger.close();
        await this.channel.stop();
        // Only write SLEEPING state if we still own the lock
        let isSuperseded = false;
        try {
            const pidStr = await fsp.readFile(join(this.blockPath, '.lock'), 'utf8');
            if (Number(pidStr.trim()) !== process.pid) isSuperseded = true;
        } catch { /* proceed if no lock */ }

        if (!isSuperseded) {
            await savePulseState(this.blockPath, {
                status: 'SLEEPING',
                lastRun: new Date().toISOString(),
                nextWakeUp: null,
                currentTask: null,
                error: null,
            });
        }

        const sessionReport = this.costTracker.getSessionReport();
        const totalReport = this.costTracker.getTotalReport();
        console.log('');
        log.monitor(this.blockConfig.name, this.monitorName, t.monitor.goingToSleep);
        log.dim(`  ${t.monitor.currentSession}: ${sessionReport}`);
        log.dim(`  ${t.monitor.completeSession}: ${totalReport}`);
    }

    private async tick(): Promise<void> {
        if (!this.running) return;
        try {
            const cronsPath = join(getWsRoot(), 'crons.json');
            const data = await fsp.readFile(cronsPath, 'utf8').catch(() => '{}');
            const crons = JSON.parse(data);
            
            const now = new Date();
            const currentMinute = now.getMinutes();
            if (this._lastCronMinute === currentMinute) return;
            this._lastCronMinute = currentMinute;

            for (const [name, job] of Object.entries(crons)) {
                const j = job as any;
                if (j.target === this.blockConfig.name) {
                    const matchPattern = (val: string, current: number) => {
                        if (val === '*') return true;
                        if (val.includes('/')) {
                            const step = parseInt(val.split('/')[1], 10);
                            return current % step === 0;
                        }
                        return parseInt(val, 10) === current;
                    };
                    const parts = j.cron_expression.split(' ');
                    if (parts.length !== 5) continue;
                    const [min, hour, dom, mon, dow] = parts;
                    
                    const isMatch = matchPattern(min, now.getMinutes()) &&
                                  matchPattern(hour, now.getHours()) &&
                                  matchPattern(dom, now.getDate()) &&
                                  matchPattern(mon, now.getMonth() + 1) &&
                                  matchPattern(dow, now.getDay());

                    if (isMatch) {
                        log.system(this.blockConfig.name, `Cron event triggered: ${name}`);
                        // Invoke non-blocking self-directed message
                        this.handleUserMessage(`Timer elapsed: [${name}]\nInstruction: ${j.instruction}`);
                    }
                }
            }
        } catch { /* ignore */ }
    }

    private async handleUserMessage(content: string, sourceChannel?: string): Promise<void> {
        this.logger.logUser(content, {
            channel: sourceChannel || this.blockConfig.channel.type,
            chatId: this.blockConfig.channel.telegram?.chatId,
        });

        let llmContent = content;

        // Native Slash Commands Interception
        const text = content.trim();
        if (text.startsWith('/')) {
            const parts = text.split(/\s+/);
            const cmd = parts[0].toLowerCase();
            let handled = false;
            let output = '';
            let shouldContinue = false;

            if (cmd === '/status') {
                handled = true;
                output = await this.getSystemStatus();
                shouldContinue = parts.length > 1;
                llmContent = text.substring(cmd.length).trim();
            } else if (cmd === '/create-block') {
                handled = true;
                if (parts.length < 2) {
                    output = 'Usage: /create-block <name> [optional instructions]';
                } else {
                    const name = parts[1];
                    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) {
                        output = 'Invalid block name. Use lowercase letters, numbers, hyphens (max 32).';
                    } else {
                        output = await this.createBlockNatively(name);
                        shouldContinue = parts.length > 2;
                        llmContent = text.substring(cmd.length + name.length + 1).trim();
                    }
                }
            } else if (cmd.startsWith('/switch')) {
                handled = true;
                const target = cmd.startsWith('/switch-') ? cmd.slice(8) : parts[1];
                if (!target) {
                    output = 'Usage: /switch-<block> or /switch <block>';
                } else {
                    output = `To switch to \`${target}\`, suspend this session (Ctrl+C) and run:\n\`mblk start ${target}\``;
                }
            }

            if (handled) {
                if (output) {
                    // Send directly back to where it came from if multi-channel 
                    await this.sendToChannel(`⚙️ **System:**\n${output}`, sourceChannel);
                }
                if (!shouldContinue) return;
            }
        }

        // Apply source headers for multi-channel differentiation before sending to LLM
        if (sourceChannel) {
            llmContent = `[Source: channel:${sourceChannel}]\n${llmContent || content}`;
        } else {
            llmContent = llmContent || content;
        }

        // If command had trailing text (or wasn't a command), let the AI respond.
        this.messages.push({ role: 'user', content: llmContent });
        try {
            await this.runConversationLoop(sourceChannel);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(`Monitor error: ${message}`);
            const errMsg = `Something went wrong on my end. Give me a moment and try again.\n\n_${message}_`;
            await this.sendToChannel(errMsg);
        }
    }

    private async runConversationLoop(sourceChannel?: string): Promise<void> {
        const { adapter, blockConfig, blockPath } = this;

        while (this.running) {
            const tools = this.getToolDefinitions();
            
            const streamCb = this.channel.streamChunk ? (chunk: string) => this.channel.streamChunk!(chunk) : undefined;
            const response = adapter.converseStream && streamCb
                ? await adapter.converseStream(this.messages, tools, streamCb)
                : await adapter.converse(this.messages, tools);

            // System-level token tracking
            this.memory.trackUsage(response.usage);
            this.costTracker.track(response.usage);

            this.messages.push(response.message);

            if (response.stopReason === 'tool_use' && response.message.toolCalls) {
                // Log tool calls compactly in a single dim line
                const toolNames = response.message.toolCalls.map(tc => `[${tc.name}]`).join(' ');
                log.system(blockConfig.name, `\nTOOLS: ${toolNames}`);

                const toolResults = await this.dispatchToolCalls(response.message.toolCalls);

                // CRITICAL: Every tool_use must have a corresponding tool_result in the very next message
                this.messages.push({ role: 'tool', toolResults });

                if (response.message.toolCalls.some((tc: any) => tc.name === 'list_tools_available')) {
                    this.toolsDiscovered = true;
                    this.toolsUsedThisCycle = false;
                } else if (this.toolsDiscovered) {
                    this.toolsUsedThisCycle = true;
                }

                // Trim tool results in history to save tokens on next turn
                this.trimHistory();

                await this.syncIdentityFromFiles();
                continue;
            }

            if (response.message.content) {
                // Send response (token info passed as metadata)
                await this.sendToChannel(response.message.content, sourceChannel, this.costTracker.getPerTurnReport());
            }

            // Trim history AFTER sending response — keeps API messages lean
            this.trimHistory();

            // Save trimmed session state for resumption on crash/restart
            await this.saveSessionState();

            if (this.memory.shouldSummarize()) {
                this.logger.logSystem('Memory threshold reached — summarizing context.');
                log.system(blockConfig.name, 'Memory threshold. Smart-saving context...');

                // Save smart memory (key info only, not full conversation)
                const freshMemory = await this.memory.summarize(adapter, this.messages, blockPath);
                const monitorContent = await this.readFile(join(blockPath, 'monitor.md'));
                const wsRoot = getWsRoot();
                const founderContent = await this.readFile(join(wsRoot, 'founder.md'));
                const systemPrompt = this.buildSystemPrompt(
                    blockConfig, monitorContent, freshMemory, founderContent, false,
                );
                this.messages = [{ role: 'system', content: systemPrompt }];
                this.toolsDiscovered = false;

                // Save tokens on threshold
                await this.costTracker.save();
            }

            break;
        }
    }

    /** Save smart memory — only key context, not full conversation. For session resumption. */
    private async saveSmartMemory(): Promise<void> {
        const { blockPath } = this;
        const memoryPath = join(blockPath, 'memory.md');

        // Only save if we had meaningful conversation
        if (this.messages.length <= 2) return;

        try {
            // Extract key context from conversation (last user messages and assistant responses)
            const keyMessages = this.messages
                .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
                .slice(-10); // Last 10 meaningful exchanges

            const summary = [
                '# Memory',
                '',
                `> Last session: ${new Date().toISOString()}`,
                `> Session tokens: ${this.costTracker.getSessionReport()}`,
                '',
                '## Recent Context',
            ];

            for (const msg of keyMessages) {
                if (msg.role === 'user') {
                    summary.push(`- **User:** ${(msg.content || '').slice(0, 200)}`);
                } else if (msg.content) {
                    summary.push(`- **Monitor:** ${msg.content.slice(0, 200)}`);
                }
            }

            summary.push('', '## Notes');
            summary.push('(Search logs/ for full conversation history)');

            await fsp.writeFile(memoryPath, summary.join('\n'), 'utf-8');
        } catch {
            // Non-critical — don't crash on memory save failure
        }
    }

    private async getSystemStatus(): Promise<string> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const dirs = await fsp.readdir(blocksDir);
            let out = '🚥 **System Status**\n\n';
            for (const d of dirs) {
                if (d.startsWith('_') || d.startsWith('.')) continue;
                const bPath = join(blocksDir, d);
                const isDir = await fsp.stat(bPath).then(s => s.isDirectory()).catch(() => false);
                if (!isDir) continue;

                try {
                    const blockCfgStr = await fsp.readFile(join(bPath, 'config.json'), 'utf8');
                    const blockCfg = JSON.parse(blockCfgStr);
                    const pulseStr = await fsp.readFile(join(bPath, 'pulse.json'), 'utf8').catch(() => '{}');
                    const pulse = JSON.parse(pulseStr);
                    const status = pulse.status || 'UNKNOWN';
                    const icon = status === 'ACTIVE' ? '🟢' : '💤';
                    out += `${icon} **${blockCfg.name}** — ${blockCfg.description || 'No description'} _(${status})_\n`;
                } catch {
                    // ignore corrupted blocks
                }
            }
            return out;
        } catch (err) {
            return `Failed to read status: ${(err as Error).message}`;
        }
    }

    private async createBlockNatively(name: string): Promise<string> {
        try {
            const globalConfig = await loadGlobalConfig();
            const blocksDir = resolveBlocksDir(globalConfig);
            const blockPath = join(blocksDir, name);

            if (await pathExists(blockPath)) {
                return `Block \`${name}\` already exists.`;
            }

            await ensureDir(blockPath);
            await ensureDir(join(blockPath, 'agents'));
            await ensureDir(join(blockPath, 'logs'));

            const config = {
                name,
                description: 'Created via slash command',
                adapter: globalConfig.defaults.adapter,
                memory: globalConfig.defaults.memory,
                pulse: globalConfig.defaults.pulse,
                channel: { type: 'cli' },
                tools: { enabled: ['*'], sandbox: false }
            };

            await saveBlockConfig(blockPath, config as any);
            await savePulseState(blockPath, {
                status: 'SLEEPING',
                lastRun: new Date().toISOString(),
                nextWakeUp: null,
                currentTask: null,
                error: null
            } as any);

            await fsp.writeFile(join(blockPath, 'memory.md'), `# ${name}\n\n(no memory yet)`, 'utf8');
            await fsp.writeFile(join(blockPath, 'monitor.md'), `You are an AI assistant in the block: ${name}.`, 'utf8');

            return `✅ Block \`${name}\` created natively.`;
        } catch (err) {
            return `Failed to create block: ${(err as Error).message}`;
        }
    }

    /**
     * Trim tool results in message history to save tokens.
     * 
     * This is SYSTEM-LEVEL compaction — no model calls, zero extra cost.
     * Only the internal `this.messages` array is trimmed. Full content is
     * preserved in ConversationLogger and CLIChannel output.
     * 
     * Rules:
     * - list_tools_available results → "(N tools discovered)"
     * - read_file results > 500 chars → truncated with note
     * - search_files results > 500 chars → truncated with note
     * - write_file / replace_in_file → kept as-is (already compact)
     * - execute_command output > 1000 chars → truncated
     */
    private trimHistory(): void {
        // Max chars for different tool types in history
        const TRIM_LIMITS: Record<string, { limit: number; hint: string }> = {
            read_file: { limit: 500, hint: 'call read_file again if you need the full content' },
            search_files: { limit: 500, hint: 'call search_files again to see more results' },
            execute_command: { limit: 1000, hint: 're-run the command if you need the full output' },
        };

        let seenListTools = false;

        // Iterate backwards to keep the MOST RECENT tool results intact if needed
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            if (msg.role !== 'tool' || !msg.toolResults) continue;

            for (const result of msg.toolResults) {
                // Special case: list_tools_available → ultra compact (only trim old ones)
                if (result.name === 'list_tools_available') {
                    if (!seenListTools) {
                        seenListTools = true;
                        continue; // Keep the first (most recent) discovery intact for the LLM!
                    }
                    // Prevent double-trimming which corrupts the count to 0
                    if (!result.content.startsWith('(')) {
                        const toolCount = (result.content.match(/^- /gm) || []).length;
                        result.content = `(${toolCount} tools previously discovered)`;
                    }
                    continue;
                }

                const config = TRIM_LIMITS[result.name];
                // Only trim if it hasn't been trimmed already
                if (config && result.content.length > config.limit && !result.content.includes('(trimmed for efficiency')) {
                    result.content = result.content.slice(0, config.limit) +
                        `\n...(trimmed for efficiency — ${config.hint})`;
                }
            }
        }
    }

    /**
     * Save trimmed session state for resumption.
     * If the terminal crashes or the user restarts, we can pick up
     * from the trimmed messages rather than starting from scratch.
     * This is separate from memory.md (which is for cross-session context).
     */
    private async saveSessionState(): Promise<void> {
        const sessionPath = join(this.blockPath, 'session.json');
        try {
            // Only save user/assistant messages (not system — rebuilt on start)
            const sessionMessages = this.messages
                .filter((m) => m.role !== 'system')
                .map((m) => ({
                    role: m.role,
                    content: m.content,
                    toolCalls: m.toolCalls,
                    toolResults: m.toolResults,
                }));

            await fsp.writeFile(sessionPath, JSON.stringify({
                monitorName: this.monitorName,
                monitorEmoji: this.monitorEmoji,
                toolsDiscovered: this.toolsDiscovered,
                toolsUsedThisCycle: this.toolsUsedThisCycle,
                messages: sessionMessages,
                savedAt: new Date().toISOString(),
            }, null, 2), 'utf-8');
        } catch {
            // Non-critical — session state is a convenience, not a requirement
        }
    }

    /** Sync monitor identity after tool calls (since background daemons never restart natively). */
    private async syncIdentityFromFiles(): Promise<void> {
        const { blockPath } = this;
        let identityChanged = false;

        // 1. Always prioritize reading the latest config.json (updated by tools)
        try {
            const configStr = await this.readFile(join(blockPath, 'config.json'));
            const diskConfig = JSON.parse(configStr) as BlockConfig;
            
            // Check if identity changed in config
            if (diskConfig.monitorName && diskConfig.monitorName !== this.monitorName) {
                this.monitorName = diskConfig.monitorName;
                identityChanged = true;
            }
            if (diskConfig.monitorEmoji && diskConfig.monitorEmoji !== this.monitorEmoji) {
                this.monitorEmoji = diskConfig.monitorEmoji;
                identityChanged = true;
            }
            
            // Apply all config updates to the local running map
            this.blockConfig = diskConfig;
        } catch { /* ignore parse errors */ }

        // 2. Fallback check for manual edits to monitor.md
        const content = await this.readFile(join(blockPath, 'monitor.md'));
        const nameMatch = content.match(/^\*\*Name:\*\*\s+(.+)$/m);
        const emojiMatch = content.match(/^\*\*Emoji:\*\*\s+(.+)$/m);

        const mdName = nameMatch?.[1]?.trim();
        const mdEmoji = emojiMatch?.[1]?.trim();

        if (mdName && mdName !== '(not set — will be chosen on first run)' &&
            (mdName !== this.monitorName || (mdEmoji && mdEmoji !== this.monitorEmoji))) {
            
            this.monitorName = mdName;
            this.monitorEmoji = mdEmoji || this.monitorEmoji;
            identityChanged = true;

            // Reflect markdown-driven identity changes back into the config
            this.blockConfig = { ...this.blockConfig, monitorName: this.monitorName, monitorEmoji: this.monitorEmoji };
            await saveBlockConfig(blockPath, this.blockConfig);
        }

        if (identityChanged) {
            log.monitor(this.blockConfig.name, `${this.monitorEmoji} ${this.monitorName}`, 'Identity updated dynamically.');
        }
    }

    private async dispatchToolCalls(toolCalls: NonNullable<LLMMessage['toolCalls']>) {
        const { registry, blockPath, blockConfig } = this;
        const results = [];
        const sandbox = blockConfig.tools.sandbox;
        const workingDir = blockConfig.tools.workingDir || blockPath;

        for (const tc of toolCalls) {
            try {
                const toolDef = registry.listTools().find((t: ToolDefinition) => t.name === tc.name);

                // Smart approval: skip approval for safe commands
                if (toolDef?.requiresApproval && tc.name === 'execute_command') {
                    const cmd = (tc.input as Record<string, string>).command || '';
                    const isSafe = SAFE_PREFIXES.some((p) => cmd.trim().startsWith(p));
                    if (!isSafe) {
                        const approved = await this.gatekeeper.requestApproval(tc.name, tc.input);
                        if (!approved) {
                            results.push({ toolCallId: tc.id, name: tc.name, content: 'Action denied by user.', isError: true });
                            continue;
                        }
                    }
                } else if (toolDef?.requiresApproval) {
                    const approved = await this.gatekeeper.requestApproval(tc.name, tc.input);
                    if (!approved) {
                        results.push({ toolCallId: tc.id, name: tc.name, content: 'Action denied by user.', isError: true });
                        continue;
                    }
                }

                const result = await registry.execute(tc.name, tc.input, {
                    blockPath,
                    blockName: blockConfig.name,
                    workingDir,
                    sandbox,
                    dispatchMessage: async (target: string, content: string) => {
                        // Log it to the conversation history
                        this.logger.logMonitor(content, {
                            channel: target,
                            monitorName: this.monitorName,
                            emoji: this.monitorEmoji,
                        });

                        // Dispatch selectively via multi-channel manager overrides
                        await this.channel.send({
                            blockName: this.blockConfig.name,
                            monitorName: `${this.monitorEmoji} ${this.monitorName}`,
                            content,
                            isSystem: false,
                            timestamp: new Date().toISOString(),
                            _targetChannel: target,
                        });
                    }
                });
                results.push({ toolCallId: tc.id, name: tc.name, content: result.content, isError: result.isError });
            } catch (err) {
                // Return errors as tool results to keep history healthy
                results.push({
                    toolCallId: tc.id,
                    name: tc.name,
                    content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                    isError: true,
                });
            }
        }

        return results;
    }

    private getToolDefinitions(): ToolDefinition[] {
        // ALWAYS provide the discovery tool.
        const discoveryTool = this.registry.getDiscoveryTool();

        if (!this.toolsDiscovered) {
            // First contact: only provide discovery tool
            return [discoveryTool];
        }

        if (!this.toolsUsedThisCycle) {
            // Discovered but not yet used — send full schemas for ONE cycle
            return [discoveryTool, ...this.registry.listTools()];
        }

        // After tools have been used: only provide discovery tool + compact reminder
        // This saves ~2,500 tokens per turn by not re-sending all 11 tool schemas
        return [discoveryTool];
    }

    private async sendToChannel(content: string, targetChannel?: string, costReport?: string, sessionReport?: string, totalReport?: string): Promise<void> {
        this.logger.logMonitor(content, {
            channel: targetChannel || this.blockConfig.channel.type,
            monitorName: this.monitorName,
            emoji: this.monitorEmoji,
        });

        await this.channel.send({
            blockName: this.blockConfig.name,
            monitorName: `${this.monitorEmoji} ${this.monitorName}`,
            content,
            isSystem: false,
            timestamp: new Date().toISOString(),
            _targetChannel: targetChannel,
            costReport,
            sessionReport,
            totalReport,
        });
    }

    private async readFile(path: string): Promise<string> {
        try {
            return await fsp.readFile(path, 'utf-8');
        } catch {
            return '';
        }
    }

    private buildSystemPrompt(
        config: BlockConfig,
        monitorMd: string,
        memoryMd: string,
        founderMd: string,
        isFirstRun: boolean,
    ): string {
        const goals = config.goals.length > 0
            ? config.goals.map((g: string, i: number) => `${i + 1}. ${g}`).join('\n')
            : 'No specific goals set yet.';

        const parts: string[] = [];
        const absoluteMonitorPath = join(this.blockPath, 'monitor.md');
        const absoluteMemoryPath = join(this.blockPath, 'memory.md');
        const absoluteFounderPath = join(getWsRoot(), 'founder.md');

        if (isFirstRun) {
            parts.push(SYSTEM_PROMPTS.MONITOR_FIRST_RUN(config.name, absoluteMonitorPath, absoluteMemoryPath, absoluteFounderPath));
        } else {
            parts.push(SYSTEM_PROMPTS.MONITOR_RESUME(this.monitorName, this.monitorEmoji, config.name));
        }

        if (config.description) {
            parts.push(`\n**Block:** ${config.description}`);
        }

        parts.push(`\n## Your Goals\n${goals}`);

        parts.push(`\n${SYSTEM_PROMPTS.OPERATING_GUIDELINES(this.channel.getActiveChannels?.() || [this.channel.name])}`);

        if (monitorMd && !monitorMd.includes('(not set')) {
            parts.push(`\n## Your Identity\n${monitorMd}`);
        }

        if (founderMd && !founderMd.includes('(unknown)')) {
            parts.push(`\n## The Founder\n${founderMd}`);
        }

        if (memoryMd && !memoryMd.includes('No history yet')) {
            parts.push(`\n## Memory (Previous Context)\n${memoryMd}`);
        }

        if (this.toolsDiscovered && this.toolsUsedThisCycle) {
            parts.push(`\n${SYSTEM_PROMPTS.TOOL_REMINDER(this.registry.listTools().length)}`);
        }

        return parts.join('\n');
    }
}