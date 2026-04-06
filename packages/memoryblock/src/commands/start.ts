import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
    loadGlobalConfig, loadBlockConfig, loadAuth, resolveBlockPath, isInitialized,
    saveBlockConfig, resolveBlocksDir, loadPulseState, savePulseState,
} from '@memoryblock/core';
import { t } from '@memoryblock/locale';
import { Monitor } from '@memoryblock/core';
import { promises as fsp } from 'node:fs';
import { pathExists } from '@memoryblock/core';
import { log } from '@memoryblock/core';
import { join } from 'node:path';
import { PROVIDERS, PLUGINS } from '../constants.js';

// Use variable-based dynamic imports so TypeScript doesn't try to resolve
// these at compile time. They are runtime-only dependencies.
const ADAPTERS_PKG = '@memoryblock/adapters';
const TOOLS_PKG = '@memoryblock/tools';
const CHANNELS_PKG = '@memoryblock/channels';
const WEB_SEARCH_PKG = '@memoryblock/plugin-web-search';
const DAEMON_PKG = '@memoryblock/daemon';
const AGENTS_PKG = '@memoryblock/plugin-agents';

async function setupBlockRuntimeLogs(
    blockConfig: any,
    blockPath: string,
    auth: any,
    options: { channel?: string; daemon?: boolean } | undefined,
    channelType: string
) {
    const model = blockConfig.adapter.model.split('.').pop()?.replace(/-v\d.*$/, '') || blockConfig.adapter.model;

    if (options?.daemon) {
        log.dim(`  ${model} · daemon · ${blockConfig.tools.sandbox ? 'sandboxed' : 'unrestricted'}`);
        return {};
    }

    log.dim(`  ${model} · ${channelType} · ${blockConfig.tools.sandbox ? 'sandboxed' : 'unrestricted'}`);
    console.log('');

    // Initialize adapter
    let adapter: any;
    try {
        const adapters = await import(ADAPTERS_PKG);
        const provider = blockConfig.adapter.provider || 'bedrock';

        if (provider === 'openai') {
            adapter = new adapters.OpenAIAdapter({
                model: blockConfig.adapter.model,
                apiKey: auth.openai?.apiKey || process.env.OPENAI_API_KEY,
            });
            log.dim(`  ✓ openai adapter`);
        } else if (provider === 'gemini') {
            adapter = new adapters.GeminiAdapter({
                model: blockConfig.adapter.model,
                apiKey: auth.gemini?.apiKey || process.env.GEMINI_API_KEY,
            });
            log.dim(`  ✓ gemini adapter`);
        } else if (provider === 'anthropic') {
            adapter = new adapters.AnthropicAdapter({
                model: blockConfig.adapter.model,
                apiKey: auth.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY,
            });
            log.dim(`  ✓ anthropic adapter`);
        } else {
            // Bedrock: pass credentials directly
            adapter = new adapters.BedrockAdapter({
                model: blockConfig.adapter.model,
                region: blockConfig.adapter.region || auth.aws?.region || 'us-east-1',
                maxTokens: blockConfig.adapter.maxTokens,
                accessKeyId: auth.aws?.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: auth.aws?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
            });
            log.dim(`  ✓ bedrock adapter`);
        }
    } catch (err) {
        throw new Error(`Failed to load adapter: ${(err as Error).message}`);
    }

    // Initialize tool registry
    let registry: any;
    try {
        const tools = await import(TOOLS_PKG);
        registry = tools.createDefaultRegistry();

        // Try loading web search plugin
        try {
            const webSearch = await import(WEB_SEARCH_PKG);
            if (webSearch.tools) {
                for (const tool of webSearch.tools) {
                    registry.register(tool);
                }
            }
            log.dim(`  ✓ web search plugin`);
        } catch {
            // Not installed — that's fine, it's optional
        }

        // Try loading agent orchestration plugin
        try {
            const agentsPlugin = await import(AGENTS_PKG);
            if (agentsPlugin.tools) {
                for (const tool of agentsPlugin.tools) {
                    registry.register(tool);
                }
            }
            log.dim(`  ✓ agent orchestration plugin`);
        } catch {
            // Not installed — that's fine, it's optional
        }

        log.dim(`  ✓ ${registry.listTools().length} tools loaded`);
    } catch (err) {
        throw new Error(`Failed to load tools: ${(err as Error).message}`);
    }

    // Initialize channel(s)
    let channel: any;
    try {
        const channels = await import(CHANNELS_PKG);
        const activeChannels: any[] = [];

        // Only bind CLI if TTY is available, otherwise background daemons will crash
        if (process.stdout.isTTY && !options?.daemon) {
            activeChannels.push(new channels.CLIChannel(blockConfig.name));
        }

        // Add Telegram if configured
        const telegramToken = auth.telegram?.botToken;
        if (telegramToken) {
            const globalConfig = await loadGlobalConfig();
            const chatId = blockConfig.channel.telegram?.chatId || auth.telegram?.chatId || '';
            const enableAlerts = globalConfig.channelAlerts ?? true;
            activeChannels.push(new channels.TelegramChannel(blockConfig.name, chatId, enableAlerts));
        }

        // Add WebChannel when: daemon mode, explicit 'web' or 'multi' channel, or block config says web
        if (options?.daemon || channelType === 'web' || channelType === 'multi' ||
            blockConfig.channel.type?.includes('web')) {
            activeChannels.push(new channels.WebChannel(blockConfig.name, blockPath));
        }

        // Wrap them in the MultiChannelManager
        channel = new channels.MultiChannelManager(activeChannels);

        const names = activeChannels.map((c: any) => c.name).join(', ');
        log.dim(`  ✓ bound channels: ${names}`);
    } catch (err) {
        throw new Error(`Failed to load channel: ${(err as Error).message}`);
    }

    console.log('');
    return { adapter, registry, channel };
}

/**
 * Attach a CLI readline to a running daemon instance.
 * Instead of starting a new Monitor, we write messages to chat.json
 * and watch for assistant replies — piggybacking on the WebChannel.
 */
async function attachCLIToRunningBlock(blockName: string, blockPath: string): Promise<void> {
    const { createInterface, moveCursor, clearLine } = await import('node:readline');
    const { watch } = await import('node:fs');

    const chatFile = join(blockPath, 'chat.json');
    const THEME = {
        brand: chalk.hex('#7C3AED'),
        brandBg: chalk.bgHex('#7C3AED').white.bold,
        founderBg: chalk.bgHex('#1c64c8ff').white.bold,
        system: chalk.hex('#6B7280'),
        dim: chalk.dim,
    };

    // Load block config to get monitor name
    const blockConfig = await loadBlockConfig(blockPath);
    const monitorLabel = blockConfig.monitorEmoji
        ? `${blockConfig.monitorEmoji} ${blockConfig.monitorName || 'Monitor'}`
        : blockConfig.monitorName || 'Monitor';

    console.log(THEME.system('  ╭───────────────────────────────────────────────────╮'));
    console.log(THEME.system('  │') + ' attached to running instance '
        + THEME.system('                     │'));
    console.log(THEME.system('  │') + ' type a message and press enter. ctrl+c to detach. '
        + THEME.system('│'));
    console.log(THEME.system('  ╰───────────────────────────────────────────────────╯'));
    console.log('');

    // Track which messages we've already displayed
    let lastKnownLength = 0;
    try {
        const raw = await fsp.readFile(chatFile, 'utf8');
        const msgs = JSON.parse(raw);
        lastKnownLength = msgs.length;
    } catch {
        // chat.json doesn't exist yet, that's fine
    }

    // Helper: format and display a chat message (matches CLIChannel style)
    const displayMessage = (m: any) => {
        if (m.role === 'system') {
            // System messages: compact + dimmed (same as CLIChannel)
            console.log(THEME.system(`  │  ${(m.content || '').replace(/\n/g, '\n  │  ')}`));
        } else if (m.role === 'assistant') {
            console.log('');
            console.log(`${THEME.brandBg(` ${monitorLabel} `)} ${THEME.system(blockName)}`);
            console.log('');
            const formatted = (m.content || '')
                .replace(/\*\*(.*?)\*\*/g, (_: string, p1: string) => chalk.bold(p1))
                .replace(/`([^`]+)`/g, (_: string, p1: string) => chalk.cyan(p1))
                .replace(/_(.*?)_/g, (_: string, p1: string) => chalk.italic(p1));
            console.log(formatted);
            if (m.costReport) {
                console.log('');
                console.log(THEME.dim(`[${m.costReport}]`));
            }
            console.log('');
        }
    };

    // Helper: check for pending approval and prompt the user
    let approvalActive = false;
    let approvalToolName = '';
    const checkApproval = async () => {
        if (approvalActive) return;
        const approvalFile = join(blockPath, 'approval_request.json');
        try {
            const raw = await fsp.readFile(approvalFile, 'utf8');
            const data = JSON.parse(raw);
            if (data.status === 'pending') {
                approvalActive = true;
                approvalToolName = data.toolName;
                console.log('');
                console.log(chalk.bgYellow.black(' ⚠ APPROVAL REQUIRED '));
                console.log('');
                console.log(`  ${chalk.bold(data.toolName)} ${THEME.dim('·')} ${THEME.dim(data.toolDescription || data.description || '')}`);
                console.log(`  ${THEME.dim(`${data.blockName} · ${data.monitorName}`)}`);
                console.log('');
                console.log(`  ${chalk.yellow('A')} ${THEME.dim('or')} ${chalk.yellow('Enter')} ${THEME.dim('= approve')}  ·  ${chalk.yellow('D')} ${THEME.dim('= deny')}`);
                console.log('');
            }
        } catch { /* no approval pending */ }
    };

    // Watch chat.json for new assistant responses
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(blockPath, (_, filename) => {
        if (filename === 'chat.json') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    const raw = await fsp.readFile(chatFile, 'utf8');
                    const msgs = JSON.parse(raw);
                    for (let i = lastKnownLength; i < msgs.length; i++) {
                        displayMessage(msgs[i]);
                    }
                    lastKnownLength = msgs.length;
                } catch { /* ignore read errors */ }
            }, 300);
        }
        if (filename === 'approval_request.json') {
            setTimeout(() => checkApproval(), 200);
        }
    });

    // Also poll as fallback (FSEvents can miss cross-process writes)
    const pollInterval = setInterval(async () => {
        try {
            const raw = await fsp.readFile(chatFile, 'utf8');
            const msgs = JSON.parse(raw);
            if (msgs.length > lastKnownLength) {
                for (let i = lastKnownLength; i < msgs.length; i++) {
                    displayMessage(msgs[i]);
                }
                lastKnownLength = msgs.length;
            }
        } catch { /* ignore */ }
        // Also poll for approvals
        await checkApproval();
    }, 2000);

    // Readline for user input
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', async (line: string) => {
        const content = line.trim();
        if (!content && !approvalActive) return;

        // Handle approval: A / Enter (empty) / approve = approve, D / deny = deny
        if (approvalActive) {
            const lower = content.toLowerCase();
            const isApprove = lower === 'a' || lower === 'approve' || content === '';
            const isDeny = lower === 'd' || lower === 'deny';

            if (isApprove || isDeny) {
                const decision = isApprove ? 'approved' : 'denied';
                const approvalFile = join(blockPath, 'approval_request.json');
                try {
                    const raw = await fsp.readFile(approvalFile, 'utf8');
                    const data = JSON.parse(raw);
                    data.status = decision;
                    data.resolvedAt = new Date().toISOString();
                    await fsp.writeFile(approvalFile, JSON.stringify(data, null, 2), 'utf8');

                    moveCursor(process.stdout, 0, -1);
                    clearLine(process.stdout, 0);
                    if (isApprove) {
                        console.log(chalk.green(`  ✓ ${approvalToolName} approved`));
                    } else {
                        console.log(chalk.red(`  ✗ ${approvalToolName} denied`));
                    }
                    console.log('');
                    approvalActive = false;
                    approvalToolName = '';
                } catch (err) {
                    console.error(THEME.system(`  Failed to resolve: ${(err as Error).message}`));
                }
                return;
            }
            // If something else typed during approval, treat as regular message
        }

        if (!content) return;

        // Style the user input
        moveCursor(process.stdout, 0, -1);
        clearLine(process.stdout, 0);
        console.log(`\n${THEME.founderBg(' Founder ')} ${content}`);

        // Write to chat.json so the daemon's WebChannel picks it up
        try {
            let msgs: any[] = [];
            try {
                const raw = await fsp.readFile(chatFile, 'utf8');
                msgs = JSON.parse(raw);
            } catch { msgs = []; }

            msgs.push({
                role: 'user',
                content,
                timestamp: new Date().toISOString(),
                processed: false,  // WebChannel will pick this up
            });

            lastKnownLength = msgs.length; // Don't re-display our own message
            await fsp.writeFile(chatFile, JSON.stringify(msgs, null, 4), 'utf8');
        } catch (err) {
            console.error(THEME.system(`  Failed to send: ${(err as Error).message}`));
        }
    });

    rl.on('SIGINT', async () => {
        // Read cost data from disk before detaching
        try {
            const costRaw = await fsp.readFile(join(blockPath, 'costs.json'), 'utf8');
            const costs = JSON.parse(costRaw);
            const sessionReport = `${(costs.sessionInput || 0).toLocaleString()} in / ${(costs.sessionOutput || 0).toLocaleString()} out`;
            const totalReport = `${(costs.totalInput || 0).toLocaleString()} in / ${(costs.totalOutput || 0).toLocaleString()} out`;
            console.log('');
            console.log(THEME.dim(`  session: ${sessionReport}`));
            console.log(THEME.dim(`  total: ${totalReport}`));
        } catch { /* no cost data */ }

        console.log(THEME.dim('\n  Detached from running instance. Daemon continues in background.\n'));
        watcher.close();
        clearInterval(pollInterval);
        if (debounceTimer) clearTimeout(debounceTimer);
        rl.close();
        process.exit(0);
    });

    rl.on('close', () => {
        watcher.close();
        clearInterval(pollInterval);
        if (debounceTimer) clearTimeout(debounceTimer);
    });

    // Keep process alive
    await new Promise<void>(() => { }); // Block forever until Ctrl+C
}



/**
 * Model selection per provider.
 * For API-based providers: fetch available models dynamically.
 * Fallback: let user enter a model ID manually.
 */
async function selectModel(provider: string, auth: any): Promise<string> {
    console.log('');
    p.intro(chalk.bold('Model Selection'));
    p.log.info(`Let's pick a model for the ${chalk.bold(provider)} provider.`);

    if (provider === 'openai') {
        // Try to fetch models from OpenAI API
        const apiKey = auth.openai?.apiKey || process.env.OPENAI_API_KEY;
        if (apiKey) {
            try {
                const s = p.spinner();
                s.start('Fetching available OpenAI models...');
                const res = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                });
                const data = await res.json() as { data?: Array<{ id: string }> };
                s.stop('Models fetched.');

                if (data.data && data.data.length > 0) {
                    // Filter to chat-capable models
                    const chatModels = data.data
                        .filter(m => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('o4'))
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .slice(0, 20);

                    if (chatModels.length > 0) {
                        const selected = await p.select({
                            message: 'Select an OpenAI model:',
                            options: [
                                ...chatModels.map(m => ({ value: m.id, label: m.id })),
                                { value: '_custom', label: 'Enter custom model ID...' },
                            ],
                        });
                        if (p.isCancel(selected)) throw new Error('Model selection cancelled.');
                        if (selected !== '_custom') return selected as string;
                    }
                }
            } catch {
                // Fall through to manual entry
            }
        }
    } else if (provider === 'gemini') {
        // Try to fetch models from Gemini API
        const apiKey = auth.gemini?.apiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
            try {
                const s = p.spinner();
                s.start('Fetching available Gemini models...');
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
                const data = await res.json() as { models?: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }> };
                s.stop('Models fetched.');

                if (data.models && data.models.length > 0) {
                    const chatModels = data.models
                        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                        .filter(m => m.name.includes('gemini'))
                        .slice(0, 20);

                    if (chatModels.length > 0) {
                        const selected = await p.select({
                            message: 'Select a Gemini model:',
                            options: [
                                ...chatModels.map(m => ({
                                    value: m.name.replace('models/', ''),
                                    label: m.displayName,
                                    hint: m.name.replace('models/', ''),
                                })),
                                { value: '_custom', label: 'Enter custom model ID...' },
                            ],
                        });
                        if (p.isCancel(selected)) throw new Error('Model selection cancelled.');
                        if (selected !== '_custom') return selected as string;
                    }
                }
            } catch {
                // Fall through to manual entry
            }
        }
    } else if (provider === 'anthropic') {
        // Anthropic doesn't have a public model listing endpoint
        const selected = await p.select({
            message: 'Select an Anthropic model:',
            options: [
                { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', hint: 'latest' },
                { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', hint: 'balanced' },
                { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', hint: 'fast & affordable' },
                { value: '_custom', label: 'Enter custom model ID...' },
            ],
        });
        if (p.isCancel(selected)) throw new Error('Model selection cancelled.');
        if (selected !== '_custom') return selected as string;
    }

    // Bedrock, Ollama, or custom fallback
    const hint = provider === 'bedrock'
        ? 'e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0'
        : provider === 'ollama'
            ? 'e.g. llama3, mistral, codellama'
            : 'Enter model ID';

    const modelId = await p.text({
        message: `Enter the ${provider} model ID:`,
        placeholder: hint,
        validate: (v) => {
            if (!v || !v.trim()) return 'Model ID is required.';
        },
    });

    if (p.isCancel(modelId)) throw new Error('Model selection cancelled.');
    return (modelId as string).trim();
}

/**
 * Find existing blocks that have completed setup (have a monitor name + model configured).
 * These are candidates for copying settings from.
 */
async function findConfiguredBlocks(globalConfig: any, currentBlockName: string): Promise<Array<{ name: string; provider: string; model: string; monitorName?: string }>> {
    const blocksDir = resolveBlocksDir(globalConfig);
    const configured: Array<{ name: string; provider: string; model: string; monitorName?: string }> = [];

    try {
        const dirs = await fsp.readdir(blocksDir);
        for (const d of dirs) {
            if (d === currentBlockName || d.startsWith('_') || d.startsWith('.')) continue;
            const bPath = join(blocksDir, d);
            const isDir = await fsp.stat(bPath).then(s => s.isDirectory()).catch(() => false);
            if (!isDir) continue;

            try {
                const cfgRaw = await fsp.readFile(join(bPath, 'config.json'), 'utf8');
                const cfg = JSON.parse(cfgRaw);
                // Only show blocks that have completed setup: model is configured and monitor has a name
                if (cfg.adapter?.model && cfg.monitorName) {
                    configured.push({
                        name: cfg.name || d,
                        provider: cfg.adapter?.provider || 'bedrock',
                        model: cfg.adapter?.model || '',
                        monitorName: cfg.monitorName,
                    });
                }
            } catch {
                // Skip corrupted blocks
            }
        }
    } catch {
        // blocks dir doesn't exist yet
    }

    return configured;
}

/**
 * Mini-onboarding flow for new blocks that haven't been configured yet.
 * Runs when `mblk start <block>` is called and the block has no model set.
 * 
 * Steps:
 * 1. Offer to copy settings from an existing configured block (if any exist)
 * 2. Select provider
 * 3. Select model
 * 4. Skills & Plugins setup
 * 5. Save config
 */
async function miniOnboarding(blockConfig: any, blockPath: string, blockName: string, auth: any, globalConfig: any): Promise<any> {
    console.log('');
    log.banner();
    p.intro(chalk.bold(`Block Setup — ${blockName}`));
    p.log.info('This block needs to be configured before it can start.');

    // ─── Step 0: Copy from existing block? ────────────────
    const configuredBlocks = await findConfiguredBlocks(globalConfig, blockName);

    if (configuredBlocks.length > 0) {
        const copyChoice = await p.select({
            message: 'How would you like to configure this block?',
            options: [
                ...configuredBlocks.map(b => {
                    const shortModel = b.model.split('.').pop()?.replace(/-v\d.*$/, '') || b.model;
                    return {
                        value: b.name,
                        label: `Copy from "${b.name}"`,
                        // hint: `${b.monitorName || ''} · ${b.provider} / ${b.model.split('.').pop()?.replace(/-v\d.*$/, '') || b.model}`,
                        hint: `${b.provider} · ${shortModel}`,
                    };
                }),
                { value: '_fresh', label: 'Start fresh', hint: 'choose provider, model, and skills' },
            ],
        });

        if (p.isCancel(copyChoice)) throw new Error('Setup cancelled.');

        if (copyChoice !== '_fresh') {
            // Copy config from the selected block
            const sourceBlockPath = join(resolveBlocksDir(globalConfig), copyChoice as string);
            try {
                const sourceCfgRaw = await fsp.readFile(join(sourceBlockPath, 'config.json'), 'utf8');
                const sourceCfg = JSON.parse(sourceCfgRaw);

                // Copy adapter, memory, tools, permissions — but NOT name, monitorName, monitorEmoji, or channel
                const copied = {
                    ...blockConfig,
                    adapter: { ...sourceCfg.adapter },
                    memory: { ...sourceCfg.memory },
                    tools: { ...sourceCfg.tools },
                    permissions: { ...sourceCfg.permissions },
                    goals: [...(sourceCfg.goals || [])],
                };

                await saveBlockConfig(blockPath, copied);
                p.log.success(`Copied settings from "${copyChoice}" — provider: ${copied.adapter.provider}, model: ${copied.adapter.model.split('.').pop()?.replace(/-v\d.*$/, '') || copied.adapter.model}`);
                p.outro('Block configured. Starting...');
                return copied;
            } catch {
                p.log.warning(`Failed to copy from "${copyChoice}". Continuing with fresh setup.`);
            }
        }
    }

    // ─── Step 1: Provider Selection ───────────────────────
    const selectedProvider = await p.select({
        message: 'Select your LLM provider:',
        options: PROVIDERS,
    });

    if (p.isCancel(selectedProvider)) throw new Error('Setup cancelled.');
    const provider = selectedProvider as string;

    // ─── Step 2: Model Selection ──────────────────────────
    const model = await selectModel(provider, auth);

    // ─── Step 3: Skills & Plugins ─────────────────────────
    p.log.step(chalk.bold('Skills & Plugins'));
    p.log.info(`${chalk.green('✓')} Core tools (file ops, shell, dev) — always available`);
    p.log.info(`${chalk.green('✓')} Multi-Agent Orchestration — always available`);

    // Use the shared PLUGINS list, filtering to non-AWS plugins for block setup
    const skillOptions = PLUGINS.filter(p => p.value !== 'aws');

    let selectedSkills: symbol | string[] = [];
    if (skillOptions.length > 0) {
        selectedSkills = await p.multiselect({
            message: 'Enable additional skills:',
            options: skillOptions,
            required: false,
        });

        if (p.isCancel(selectedSkills)) throw new Error('Setup cancelled.');
    }

    // Check which plugins are actually installed
    const installedSkills: string[] = [];
    for (const skill of (selectedSkills as string[])) {
        try {
            await import(`@memoryblock/plugin-${skill}`);
            installedSkills.push(skill);
        } catch {
            p.log.info(`Plugin "${skill}" not found globally. Auto-installing...`);
            const { execSync } = await import('node:child_process');
            let installCmd = `npm install -g @memoryblock/plugin-${skill}`;
            const execPathStr = process.argv[1] || '';
            
            if (execPathStr.includes('.bun')) {
                installCmd = `bun install -g @memoryblock/plugin-${skill}`;
            } else if (execPathStr.includes('pnpm')) {
                installCmd = `pnpm add -g @memoryblock/plugin-${skill}`;
            } else if (execPathStr.includes('yarn')) {
                installCmd = `yarn global add @memoryblock/plugin-${skill}`;
            }
            
            try {
                execSync(`${installCmd} 2>&1`, { timeout: 120_000, stdio: 'ignore' });
                installedSkills.push(skill);
                p.log.success(`Successfully installed @memoryblock/plugin-${skill}`);
            } catch {
                p.log.warning(`Failed to auto-install "${skill}". Run \`${installCmd}\` manually.`);
            }
        }
    }

    // ─── Step 4: Save Config ──────────────────────────────
    const updated = {
        ...blockConfig,
        adapter: { ...blockConfig.adapter, provider, model },
    };

    await saveBlockConfig(blockPath, updated);

    p.outro('Block configured. Starting...');
    return updated;
}

/**
 * Start all enabled blocks as daemons.
 * Skips blocks that are unconfigured (no model) or already running.
 * Used by `mblk start` (no args) and `mblk restart`.
 */
export async function startAllEnabledBlocks(): Promise<void> {
    const globalConfig = await loadGlobalConfig();
    const blocksDir = resolveBlocksDir(globalConfig);

    if (!(await pathExists(blocksDir))) {
        log.dim('  No blocks directory found.');
        return;
    }

    const entries = await fsp.readdir(blocksDir, { withFileTypes: true });
    let started = 0;

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

        const blockPath = join(blocksDir, entry.name);
        try {
            const blockConfig = await loadBlockConfig(blockPath);

            // Skip disabled blocks
            if (blockConfig.enabled === false) {
                log.dim(`  ${entry.name}: disabled (skipped)`);
                continue;
            }

            // Skip unconfigured blocks (no model set)
            if (!blockConfig.adapter?.model) {
                log.dim(`  ${entry.name}: not configured (skipped)`);
                continue;
            }

            // Skip already running blocks
            const pulse = await loadPulseState(blockPath);
            if (pulse.status === 'ACTIVE') {
                const lockFile = join(blockPath, '.lock');
                try {
                    const pidStr = await fsp.readFile(lockFile, 'utf8');
                    const pid = parseInt(pidStr.trim(), 10);
                    try { process.kill(pid, 0); log.dim(`  ${entry.name}: already running (PID ${pid})`); continue; } catch { /* stale */ }
                } catch { /* no lock file */ }
            }

            // Start as daemon
            const existingPulse = await loadPulseState(blockPath);
            await savePulseState(blockPath, {
                ...existingPulse,
                status: 'SLEEPING',
                lastRun: new Date().toISOString(),
                nextWakeUp: null,
                currentTask: null,
                error: null,
            });
            const daemon = await import(DAEMON_PKG);
            const pid = await daemon.spawnDaemon(blockConfig.name, 'multi', blockPath);
            log.success(`  ${entry.name}: started (PID ${pid})`);
            started++;
        } catch (err) {
            log.warn(`  ${entry.name}: failed to start — ${(err as Error).message}`);
        }
    }

    if (started === 0) {
        log.dim('  No enabled blocks to start.');
    } else {
        log.dim(`\n  ${started} block(s) started as daemons.`);
    }
}

export async function startCommand(blockName?: string, options?: { channel?: string; daemon?: boolean }): Promise<void> {
    if (!(await isInitialized())) {
        throw new Error(t.general.notInitialized);
    }

    if (!blockName) {
        log.brand('Starting all blocks...\n');
        await startAllEnabledBlocks();
        return;
    }

    // Auto-install OS service hook quietly
    import('./service.js').then(s => s.silentServiceInstall()).catch(() => { });

    const globalConfig = await loadGlobalConfig();
    const blockPath = resolveBlockPath(globalConfig, blockName);

    if (!(await pathExists(blockPath))) {
        log.warn(`Block "${blockName}" does not exist.`);
        const createIt = await p.confirm({ message: `Would you like to create it now?` });
        if (p.isCancel(createIt) || !createIt) {
            process.exit(0);
        }
        const { createCommand } = await import('./create.js');
        await createCommand(blockName);
    }

    let blockConfig = await loadBlockConfig(blockPath);
    const auth = await loadAuth();
    const channelType = options?.channel || blockConfig.channel.type || 'cli';

    // ─── Single Instance Check ──────────────────────────────
    const pulse = await loadPulseState(blockPath);
    if (pulse.status === 'ACTIVE') {
        // Check if the lock PID is still alive (stale lock from a crash)
        const lockFile = join(blockPath, '.lock');
        let stale = false;
        try {
            const pidStr = await fsp.readFile(lockFile, 'utf8');
            const pid = parseInt(pidStr.trim(), 10);
            if (pid && pid !== process.pid) {
                try {
                    process.kill(pid, 0); // signal 0 = check if process exists
                    // Process is alive — block is genuinely running
                } catch {
                    // Process is dead — stale lock
                    stale = true;
                }
            } else if (!pid || isNaN(pid)) {
                stale = true;
            }
        } catch {
            // No lock file — might be stale from before locks existed
            stale = true;
        }

        if (!stale) {
            // Block is genuinely running — attach CLI to the running instance
            if (process.stdout.isTTY && !options?.daemon) {
                log.brand(`${blockName}\n`);
                await setupBlockRuntimeLogs(blockConfig, blockPath, auth, options, channelType);
                log.dim('  Block is already running. Attaching CLI to existing instance...\n');
                await attachCLIToRunningBlock(blockName, blockPath);
                return;
            }
            log.error(t.block.alreadyRunning(blockName));
            log.dim(`  ${t.block.singleInstanceHint}`);
            log.dim(`  ${t.block.stopHint(blockName)}\n`);
            return;
        }

        // Stale lock — clean it up and continue
        log.dim(`  ${t.block.staleLockRecovered}`);
        try { await fsp.unlink(join(blockPath, '.lock')); } catch { /* ignore */ }
    }

    // Write lock file with our PID — but NOT when spawning a daemon,
    // because the daemon child process will write its own lock.
    if (!options?.daemon) {
        await fsp.writeFile(join(blockPath, '.lock'), String(process.pid), 'utf8');
    }

    // ─── Mini-Onboarding (if block has no model configured) ─────
    if (!blockConfig.adapter.model) {
        // Daemon / non-TTY mode cannot run interactive onboarding
        if (!process.stdout.isTTY || options?.daemon) {
            throw new Error(
                `Block "${blockName}" has no model configured. ` +
                `Run \`mblk start ${blockName}\` in a terminal first to complete setup.`
            );
        }
        blockConfig = await miniOnboarding(blockConfig, blockPath, blockName, auth, globalConfig);
    }

    // Mark block as enabled (persists across reboots)
    blockConfig.enabled = true;
    await saveBlockConfig(blockPath, blockConfig);

    // ─── AM I THE DAEMON CHILD? ───────────────────────────
    if (process.env.MBLK_IS_DAEMON === '1') {
        let shuttingDown = false;
        let monitor: any = null;

        const shutdown = async () => {
            if (shuttingDown) return;
            shuttingDown = true;
            if (monitor) {
                try { await monitor.stop(); } catch { /* ignore */ }
            }
            try {
                const lockFile = join(blockPath, '.lock');
                const pidStr = await fsp.readFile(lockFile, 'utf8');
                if (Number(pidStr.trim()) === process.pid) {
                    await fsp.unlink(lockFile);
                }
            } catch { /* ignore */ }
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        process.on('uncaughtException', async (err) => {
            if (shuttingDown) return;
            log.error(t.errors.unexpected(err.message));
            await fsp.writeFile(join(blockPath, 'daemon-debug-error.log'), err.stack || err.message);
            await shutdown();
        });
        process.on('unhandledRejection', async (reason) => {
            if (shuttingDown) return;
            log.error(t.errors.unexpected(String(reason)));
            const stack = (reason as Error)?.stack || String(reason);
            await fsp.writeFile(join(blockPath, 'daemon-debug-error.log'), stack);
            await shutdown();
        });

        try {
            const { adapter, registry, channel } = await setupBlockRuntimeLogs(blockConfig, blockPath, auth, options, channelType);
            if (!adapter || !registry || !channel) return;

            // Create and start the monitor in the background
            monitor = new Monitor({ blockPath, blockConfig, adapter, registry, channel });
            await monitor.start();
        } catch (err) {

            log.error(`Daemon init failed: ${(err as Error).message}`);
            await fsp.writeFile(join(blockPath, 'daemon-debug-error.log'), (err as Error).stack || (err as Error).message);
            process.exit(1);
        }

        return; // The daemon runs indefinitely here
    }

    // ─── I AM THE PARENT CLI ──────────────────────────────
    try {
        // Reset pulse so the daemon child doesn't see stale ACTIVE status
        const existingPulse = await loadPulseState(blockPath);
        await savePulseState(blockPath, {
            ...existingPulse,
            status: 'SLEEPING',
            lastRun: new Date().toISOString(),
            nextWakeUp: null,
            currentTask: null,
            error: null,
        });
        const daemon = await import(DAEMON_PKG);
        const pid = await daemon.spawnDaemon(blockConfig.name, channelType, blockPath);

        if (options?.daemon) {
            log.brand(`${blockConfig.name}\n`);
            log.success(`Daemon spawned successfully! PID: ${pid}`);
            return;
        }

        // Always background the daemon, then attach CLI natively
        log.brand(`${blockConfig.name}\n`);
        log.success(`Daemon spawned (PID ${pid}). Attaching CLI...\n`);

        // Display status banner without loading the full adapter/tools/channels stack
        // (the daemon child handles all that — the parent only needs to show info and attach)
        const model = blockConfig.adapter.model.split('.').pop()?.replace(/-v\d.*$/, '') || blockConfig.adapter.model;
        log.dim(`  ${model} · ${channelType} · ${blockConfig.tools.sandbox ? 'sandboxed' : 'unrestricted'}`);
        console.log('');

        // Let daemon init chat.json and WebChannel before tailing
        await new Promise(r => setTimeout(r, 1500));
        await attachCLIToRunningBlock(blockName, blockPath);
    } catch (err) {
        throw new Error(`Failed to spawn daemon: ${(err as Error).message}`);
    }
}