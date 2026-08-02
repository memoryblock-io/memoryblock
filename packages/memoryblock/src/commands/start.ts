import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
    loadGlobalConfig, loadBlockConfig, loadAuth, resolveBlockPath, isInitialized,
    saveBlockConfig, resolveBlocksDir, loadPulseState, savePulseState,
} from '@memoryblock/core';
import { t } from '@memoryblock/locale';
import { Monitor } from '@memoryblock/core';
import { promises as fsp } from 'node:fs';
import process from 'node:process';
import { pathExists } from '@memoryblock/core';
import { log } from '@memoryblock/core';
import { join } from 'node:path';
import { getImportantProviders, PLUGINS } from '../constants.js';

// Type-only import so `resolveSchemaFields` can cast the dynamic import
// result without pulling `aiplug` into the static import graph. The runtime
// `aiplug` load still happens lazily below.
import type * as AIPlugModule from 'aiplug';

// Use variable-based dynamic imports so TypeScript doesn't try to resolve
// these at compile time. They are runtime-only dependencies.
const ADAPTERS_PKG = '@memoryblock/adapters';
const TOOLS_PKG = '@memoryblock/tools';
const CHANNELS_PKG = '@memoryblock/channels';
const WEB_SEARCH_PKG = '@memoryblock/plugin-web-search';
const DAEMON_PKG = '@memoryblock/daemon';
const AGENTS_PKG = '@memoryblock/plugin-agents';

/**
 * Resolve credentials for any aiplug-registered provider.
 *
 * The shape of the returned object is whatever the provider's schema
 * requires — discovered at runtime from `AIPlug.configSchema(slug)`. For
 * most providers this is `{ apiKey, baseURL, model }`; for Bedrock-family
 * providers it is `{ apiKey, region, accessKeyId, secretAccessKey, baseURL,
 * model }`; for OpenAI-compatible providers that don't need a key (Ollama,
 * LM Studio) it is `{}`.
 *
 * Resolution order, per field, is uniform across all providers:
 *
 *   1. `auth.providers?.[slug]?.[field]` (generic shape from the init wizard)
 *   2. `auth?.[slug]?.[field]`           (legacy per-provider fields)
 *   3. `auth?.[legacyAlias]?.[field]`    (e.g. `auth.gemini` → `google`,
 *                                       `auth.aws` → `bedrock-aws` / `bedrock`)
 *   4. `<FIELD>` env var                (e.g. `API_KEY`, `ACCESS_KEY_ID`,
 *                                       `SECRET_ACCESS_KEY`, `REGION`,
 *                                       `BASE_URL`)
 *   5. `<SLUG>_<FIELD>` env var         (snake-cased slug + field name)
 *
 * No hardcoded provider branches — adding a new provider requires only
 * updating aiplug's registry, not memoryblock.
 */

async function resolveProviderCredentials(
  provider: string,
  auth: any,
): Promise<Record<string, string | undefined>> {
  const fields = await resolveSchemaFields(provider);
  const out: Record<string, string | undefined> = {};

  for (const field of fields) {
    out[field] = resolveField(provider, field, auth);
  }

  // Ollama and other keyless providers return an empty object — the
  // adapter factory accepts missing apiKey.
  return out;
}

/**
 * Return the field keys the provider needs (e.g. `['apiKey', 'baseURL',
 * 'model']` or `['region', 'accessKeyId', 'secretAccessKey', 'baseURL',
 * 'model']`). Driven by aiplug's introspection so adding a provider to
 * aiplug automatically extends memoryblock's config surface.
 */

async function resolveSchemaFields(provider: string): Promise<string[]> {
  try {
    // Lazy dynamic import — `aiplug` may not be installed at module load
    // (e.g. during `pnpm install` in a fresh checkout). The cast uses the
    // top-level type-only import so the type comes from the same source.
    const aiplug: typeof AIPlugModule = await import('aiplug');
    const schema = aiplug.AIPlug.configSchema(provider);
    return schema.fields.map((f) => f.key);
  } catch {
    // aiplug missing or provider unknown — fall back to the canonical
    // bearer-key shape.
    return ['apiKey', 'baseURL', 'model'];
  }
}

/**
 * Resolve a single field from auth + env. Lookup order is uniform across
 * all providers and all field types (see `resolveProviderCredentials`
 * header). Legacy aliases for the original five hardcoded providers
 * are recognised so existing `auth.json` files keep working.
 */

function resolveField(provider: string, field: string, auth: any): string | undefined {
  const slugEnv = `${provider.replace(/-/g, '_').toUpperCase()}_${field.toUpperCase()}`;
  const genericEnv = field.toUpperCase();

  // 1. Generic `auth.providers[slug][field]`
  const generic = auth?.providers?.[provider];
  if (generic && typeof generic === 'object' && field in generic) {
    return generic[field];
  }

  // 2. Legacy `auth[slug][field]`
  const legacy = auth?.[provider];
  if (legacy && typeof legacy === 'object' && field in legacy) {
    return legacy[field];
  }

  // 3. Legacy alias — only the original five providers have one. Map is
  // intentionally explicit so a typo can't silently pull from the wrong
  // account.
  const alias = LEGACY_AUTH_ALIAS[provider];
  if (alias) {
    const aliased = auth?.[alias];
    if (aliased && typeof aliased === 'object' && field in aliased) {
      return aliased[field];
    }
  }

  // 4. Provider-specific env (`MINIMAX_API_KEY`, `OPENAI_BASE_URL`, ...)
  if (process.env[slugEnv]) return process.env[slugEnv];

  // 5. Generic env (`API_KEY`, `BASE_URL`, `AWS_REGION`, ...) — for
  // AWS-family fields this is the canonical source.
  if (process.env[genericEnv]) return process.env[genericEnv];

  return undefined;
}

/**
 * Legacy `auth.json` field aliases for the original five hardcoded
 * providers. These exist so existing auth files keep working without
 * migration; new auth.json files should use `auth.providers[slug]`.
 */
const LEGACY_AUTH_ALIAS: Record<string, string> = {
  google: 'gemini',         // historical alias for Google Gemini
  bedrock: 'aws',            // bedrock shared the AWS credentials block
  'bedrock-aws': 'aws',      // bedrock-aws does too
  'bedrock-converse': 'aws',
};

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

    // Initialize adapter — generic, aiplug-driven dispatch.
    let adapter: any;
    try {
        const { createMemoryAdapter } = await import(ADAPTERS_PKG);
        const provider = blockConfig.adapter.provider || 'bedrock';
        const creds = await resolveProviderCredentials(provider, auth);

        // Block-config overrides win over auth resolution — a per-block
        // baseURL or region pin takes priority over the global default.
        const merged: Record<string, unknown> = {
            provider,
            model: blockConfig.adapter.model,
        };
        for (const [k, v] of Object.entries(creds)) {
            if (typeof v === 'string' && v.length > 0) merged[k] = v;
        }
        if (blockConfig.adapter.baseURL) merged.baseURL = blockConfig.adapter.baseURL;
        if (blockConfig.adapter.region) merged.region = blockConfig.adapter.region;
        if (blockConfig.adapter.maxTokens) merged.maxTokens = blockConfig.adapter.maxTokens;

        // Non-secret credentials (region / access keys / headers) go through
        // `providerOptions` so the adapters factory forwards them to aiplug
        // without needing to know what fields the transport consumes.
        const nonSecretKeys = ['region', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'headers'];
        const providerOptions: Record<string, unknown> = {};
        for (const k of nonSecretKeys) {
            const v = merged[k];
            if (typeof v === 'string' && v.length > 0) providerOptions[k] = v;
        }
        if (Object.keys(providerOptions).length > 0) merged.providerOptions = providerOptions;
        for (const k of nonSecretKeys) delete merged[k];

        adapter = createMemoryAdapter(merged as any);
        log.dim(`  ✓ ${provider} adapter`);
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

        // Add SharedChannel when: daemon mode, explicit 'shared/web' or 'multi' channel, or block config says shared/web
        if (options?.daemon || channelType === 'shared' || channelType === 'web' || channelType === 'multi' ||
            blockConfig.channel.type?.includes('shared') || blockConfig.channel.type?.includes('web')) {
            activeChannels.push(new channels.SharedChannel(blockConfig.name, blockPath));
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
 * and watch for assistant replies — piggybacking on the SharedChannel.
 */
async function attachCLIToRunningBlock(blockName: string, blockPath: string): Promise<void> {
    const { CLIChannel } = await import('@memoryblock/channels');
    const { watch } = await import('node:fs');

    const chatFile = join(blockPath, 'chat.json');
    const streamFile = join(blockPath, '.stream');

    // Load block config to get monitor name/emoji
    const blockConfig = await loadBlockConfig(blockPath);
    const monitorLabel = blockConfig.monitorEmoji
        ? `${blockConfig.monitorEmoji} ${blockConfig.monitorName || 'Monitor'}`
        : blockConfig.monitorName || 'Monitor';

    const cli = new CLIChannel(blockName);

    let lastKnownLength = 0;
    let lastStreamLength = 0;
    // Indices of chat.json messages whose body was already streamed via
    // flushStream (so flushChat should skip rendering their content and
    // only print the costReport). Keys are message positions in chat.json.
    const streamedMessageIndices = new Set<number>();

    try {
        const raw = await fsp.readFile(chatFile, 'utf8');
        const msgs = JSON.parse(raw);
        lastKnownLength = msgs.length;
    } catch { /* ignore */ }

    cli.onMessage(async (msg) => {
        try {
            let msgs: any[] = [];
            try {
                msgs = JSON.parse(await fsp.readFile(chatFile, 'utf8'));
            } catch { msgs = []; }

            msgs.push({
                role: 'user',
                content: msg.content,
                timestamp: msg.timestamp,
                processed: false,
            });
            lastKnownLength = msgs.length; // Don't re-display our own message
            await fsp.writeFile(chatFile, JSON.stringify(msgs, null, 4), 'utf8');
        } catch { /* ignore */ }
    });

    let approvalActive = false;
    const checkApproval = async () => {
        if (approvalActive) return;
        const approvalFile = join(blockPath, 'approval_request.json');
        try {
            const raw = await fsp.readFile(approvalFile, 'utf8');
            const data = JSON.parse(raw);
            if (data.status === 'pending') {
                approvalActive = true;
                const approved = await cli.requestApproval(data);
                
                // Write decision
                data.status = approved ? 'approved' : 'denied';
                data.resolvedAt = new Date().toISOString();
                await fsp.writeFile(approvalFile, JSON.stringify(data, null, 2), 'utf8');
                approvalActive = false;
            }
        } catch { /* ignore */ }
    };

    const flushStream = async () => {
        try {
            const stat = await fsp.stat(streamFile);
            if (stat.size < lastStreamLength) {
                lastStreamLength = 0;
            }
            if (stat.size > lastStreamLength) {
                // Print monitor header before the first chunk of a new stream
                if (lastStreamLength === 0) {
                    cli.prepareStream(monitorLabel, blockName);
                }
                const raw = await fsp.readFile(streamFile);
                if (raw.length > lastStreamLength) {
                    const chunk = raw.subarray(lastStreamLength).toString('utf8');
                    await cli.streamChunk(chunk);
                    lastStreamLength = raw.length;
                    // Mark the next chat.json message as already-streamed so
                    // flushChat doesn't re-render its content via cli.send.
                    // The monitor writes to .stream first, then appends the
                    // assistant message to chat.json, so the message index
                    // we expect here is lastKnownLength (the next unread one).
                    streamedMessageIndices.add(lastKnownLength);
                }
            }
        } catch {
            lastStreamLength = 0; // File deleted
        }
    };

    const flushChat = async () => {
        try {
            const msgs = JSON.parse(await fsp.readFile(chatFile, 'utf8'));
            if (msgs.length > lastKnownLength) {
                // Advance the cursor BEFORE iterating. If a concurrent
                // flushChat (poll + watcher overlap) reads the same chat.json,
                // it will see lastKnownLength already up-to-date and bail out.
                const toProcess = msgs.slice(lastKnownLength);
                lastKnownLength = msgs.length;
                lastStreamLength = 0;
                for (let i = 0; i < toProcess.length; i++) {
                    const m = toProcess[i];
                    const realIndex = lastKnownLength - toProcess.length + i;
                    if (m.role === 'user') continue;

                    // Skip content for already-streamed messages — the
                    // body was already painted by cli.streamChunk, we
                    // only need the cost badge + trailing newlines.
                    const wasStreamed = streamedMessageIndices.delete(realIndex);
                    const contentToRender = wasStreamed ? '' : (m.content || '');
                    await cli.send({
                        blockName,
                        monitorName: m.role === 'system' ? 'system' : monitorLabel,
                        content: contentToRender,
                        isSystem: m.role === 'system',
                        timestamp: m.timestamp,
                        costReport: m.costReport,
                        sessionReport: m.sessionReport,
                        totalReport: m.totalReport,
                    });
                }
            }
        } catch { /* ignore */ }
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(blockPath, (_, filename) => {
        if (filename === 'chat.json') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(flushChat, 100);
        } else if (filename === '.stream') {
            flushStream();
        } else if (filename === 'approval_request.json') {
            checkApproval();
        }
    });

    const pollInterval = setInterval(async () => {
        // Enforce sequential flush to prevent race conditions during live streaming
        await flushStream();
        await flushChat();
        await checkApproval();
    }, 500);

    const shutdown = async () => {
        try {
            const costRaw = await fsp.readFile(join(blockPath, 'costs.json'), 'utf8');
            const costs = JSON.parse(costRaw);
            console.log('');
            console.log(chalk.dim(`  session: ${(costs.sessionInput || 0).toLocaleString()} in / ${(costs.sessionOutput || 0).toLocaleString()} out`));
            console.log(chalk.dim(`  total: ${(costs.totalInput || 0).toLocaleString()} in / ${(costs.totalOutput || 0).toLocaleString()} out`));
        } catch { /* ignore */ }

        console.log(chalk.dim('\nDetached from running instance. Daemon continues in background.\n'));
        watcher.close();
        clearInterval(pollInterval);
        if (debounceTimer) clearTimeout(debounceTimer);
        await cli.stop();
        process.exit(0);
    };

    process.once('SIGINT', shutdown);
    await cli.start();
}

/**
 * Model selection per provider.
 *
 * Sources `popularModels` from aiplug's registry meta (no network call, no
 * credentials required). Falls back to manual entry when the registry has
 * nothing for this slug or the user picks `_custom`.
 */
async function selectModel(provider: string, _auth: any): Promise<string> {
    console.log('');
    p.intro(chalk.bold('Model Selection'));
    p.log.info(`Let's pick a model for the ${chalk.bold(provider)} provider.`);

    let popularModels: string[] = [];
    try {
        const aiplug = await import('aiplug');
        const desc = aiplug.AIPlug.describeProvider(provider);
        popularModels = desc.popularModels ?? [];
    } catch {
        // aiplug missing or provider unknown — fall through to manual entry.
    }

    if (popularModels.length > 0) {
        const selected = await p.select({
            message: `Select a ${provider} model:`,
            options: [
                ...popularModels.map((m) => ({ value: m, label: m })),
                { value: '_custom', label: 'Enter custom model ID...' },
            ],
        });
        if (p.isCancel(selected)) throw new Error('Model selection cancelled.');
        if (selected !== '_custom') return selected as string;
    }

    const placeholder = popularModels[0] ?? 'Enter model ID';

    const modelId = await p.text({
        message: `Enter the ${provider} model ID:`,
        placeholder,
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
    // TUI uses the curated "important" shortlist (10 entries) so the prompt
    // stays scannable. A `_custom` option lets the user type any other
    // aiplug-registered slug — the full 100+ list is only ever shown in
    // the web UI, where the picker scales fine.
    const providerOptions = [
        ...getImportantProviders(),
        { value: '_custom', label: 'More…', hint: 'type any aiplug-registered provider slug' },
    ];
    const selectedProvider = await p.select({
        message: 'Select your LLM provider:',
        options: providerOptions,
    });

    if (p.isCancel(selectedProvider)) throw new Error('Setup cancelled.');

    let provider = selectedProvider as string;
    if (provider === '_custom') {
        // Free-form input for the full aiplug registry. The provider
        // string is whatever slug the user typed — aiplug's loader
        // will surface an error if the slug isn't registered, which
        // start.ts catches and turns into a user-friendly message.
        const typed = await p.text({
            message: 'Enter the aiplug provider slug:',
            placeholder: 'e.g. minimax, deepseek, zhipu, moonshot',
            validate: (v) => {
                if (!v || !v.trim()) return 'Provider slug is required.';
                if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim())) {
                    return 'Use a lowercase slug (letters, digits, hyphens).';
                }
            },
        });
        if (p.isCancel(typed)) throw new Error('Setup cancelled.');
        provider = (typed as string).trim();
    }

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

        // It might take a moment for the new daemon to write its .lock file
        await new Promise(r => setTimeout(r, 2000));
        // Let daemon init chat.json and SharedChannel before tailing
        await attachCLIToRunningBlock(blockName, blockPath);
    } catch (err) {
        throw new Error(`Failed to spawn daemon: ${(err as Error).message}`);
    }
}