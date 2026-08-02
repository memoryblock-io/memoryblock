import * as p from '@clack/prompts';
import chalk from 'chalk';
import { ensureDir, writeJson, readJsonSafe } from '@memoryblock/core';
import {
  getWsRoot, getConfigPath, getAuthPath, isInitialized,
} from '@memoryblock/core';
import { GlobalConfigSchema } from '@memoryblock/types';
import { log } from '@memoryblock/core';
import { join } from 'node:path';

import { PROVIDERS, CHANNELS, PLUGINS, PROVIDER_AUTH, CHANNEL_AUTH } from '../constants.js';
import * as ollamaInstaller from '../utils/ollama-installer.js';

// Brand palette — matches web UI CSS vars
const ACCENT = chalk.hex('#7C3AED');  // Primary accent (violet-600)
const DIM = chalk.dim;

/**
 * Legacy auth.json key for each provider. Bedrock shared the AWS
 * credentials block historically; everything else uses its own slug.
 * New auth.json files should use `auth.providers[slug]` and ignore this.
 */
const LEGACY_AUTH_SLOT: Record<string, string> = {
    bedrock: 'aws',
    'bedrock-aws': 'aws',
    'bedrock-converse': 'aws',
};

/**
 * Interactive onboarding wizard.
 * Multi-step setup: providers → channels → plugins → API keys → first block.
 * Uses @clack/prompts for styled terminal UI.
 */
export async function initCommand(options?: { nonInteractive?: boolean }): Promise<void> {
  const wsDir = getWsRoot();

  // Non-interactive: create defaults and exit
  if (options?.nonInteractive) {
    await ensureDir(wsDir);
    const defaultConfig = GlobalConfigSchema.parse({
        blocksDir: './blocks'
    });
    await writeJson(getConfigPath(), defaultConfig);
    await writeJson(getAuthPath(), {
      aws: { accessKeyId: '', secretAccessKey: '', region: 'us-east-1' },
      anthropic: { apiKey: '' },
      openai: { apiKey: '' },
      google: { apiKey: '' },
      /** @deprecated legacy alias for `google`. */
      gemini: { apiKey: '' },
      telegram: { botToken: '', chatId: '' },
      brave: { apiKey: '' }
    });
    log.brand('Initialized (non-interactive)');
    log.success(`Workspace: ${wsDir}`);
    log.success(`Config:    ${getConfigPath()}`);
    return;
  }

  const alreadyInit = await isInitialized();

  // Welcome
  console.log('');
  log.banner();
  console.log(DIM('  Deploy isolated AI workspaces on your machine.\n'));

  p.intro(chalk.bold('Setup Wizard'));

  if (alreadyInit) {
    const proceed = await p.confirm({
      message: 'Already configured globally. Re-run setup?',
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.outro('Setup cancelled.');
      return;
    }
  }

  // ─── Step 1: Providers ───────────────────────────────
  const selectedProviders = await p.multiselect({
    message: 'Which providers do you want to use?',
    options: PROVIDERS,
    initialValues: ['bedrock'],
    required: true,
  });

  if (p.isCancel(selectedProviders)) {
    p.outro('Setup cancelled.');
    return;
  }

  // ─── Step 2: Channels ───────────────────────────────
  const selectedChannels = await p.multiselect({
    message: 'Which channels do you want to enable?',
    options: CHANNELS.map(ch => ({
      ...ch,
      label: (ch.value === 'cli' || ch.value === 'web') ? `${ch.label} (always on)` : ch.label,
    })),
    initialValues: ['cli', 'web'],
    required: true,
  });

  if (p.isCancel(selectedChannels)) {
    p.outro('Setup cancelled.');
    return;
  }

  // ─── Step 3: Skills & Plugins ───────────────────────
  p.log.info(`${chalk.green('✓')} Core skills (file ops, shell, dev) — always available`);
  p.log.info(`${chalk.green('✓')} Multi-Agent Orchestration — always available`);

  let selectedPlugins: symbol | string[] = [];
  if (PLUGINS.length > 0) {
    selectedPlugins = await p.multiselect({
      message: 'Select additional skills & plugins to install:',
      options: PLUGINS.map(pl => ({
        value: pl.value,
        label: pl.label,
        hint: pl.hint,
      })),
      required: false,
    });

    if (p.isCancel(selectedPlugins)) {
      p.outro('Setup cancelled.');
      return;
    }
  }

  // ─── Step 4: API Keys ───────────────────────────────
  p.log.info(DIM('Press Enter to skip any credential — configure later with: mblk config auth'));
  const authData: Record<string, Record<string, string>> = {};

  for (const provider of (selectedProviders as string[])) {
    const providerAuth = PROVIDER_AUTH[provider];
    if (!providerAuth || providerAuth.fields.length === 0) continue;

    const providerLabel = PROVIDERS.find(p => p.value === provider)?.label || provider;
    p.log.step(`${providerLabel} credentials`);

    const data: Record<string, string> = {};
    for (const field of providerAuth.fields) {
      const value = await p.text({
        message: field.label,
        placeholder: field.key === 'region' ? 'us-east-1' : '',
        defaultValue: field.key === 'region' ? 'us-east-1' : undefined,
      });

      if (p.isCancel(value)) {
        p.outro('Setup cancelled.');
        return;
      }

      data[field.key] = (value as string) || '';
    }
    // Bedrock stores credentials under the legacy `aws` key so existing
    // auth.json files keep working. Other providers use their own slug.
    authData[LEGACY_AUTH_SLOT[provider] ?? provider] = data;
  }

  // Channel auth (only telegram has auth currently)
  for (const channel of (selectedChannels as string[])) {
    const fields = CHANNEL_AUTH[channel];
    if (!fields) continue;

    const channelLabel = CHANNELS.find(c => c.value === channel)?.label || channel;
    p.log.step(`${channelLabel} credentials`);

    const data: Record<string, string> = {};
    for (const field of fields) {
      const value = await p.text({
        message: field.label,
        placeholder: field.secret ? '' : 'optional',
      });

      if (p.isCancel(value)) {
        p.outro('Setup cancelled.');
        return;
      }

      data[field.key] = (value as string) || '';
    }
    authData[channel] = data;
  }

  // ─── Step 4b: Ollama Live Setup (only if user selected ollama) ──
  // On the first time a user picks ollama, we offer to install the binary
  // and pull a small default model. State is persisted to a workspace-local
  // ollama.json so subsequent `mblk init` runs skip these prompts.
  if ((selectedProviders as string[]).includes('ollama')) {
    await setupOllama(!!options?.nonInteractive);
  }

  // ─── Step 5: Connection Testing ─────────────────────
  const s = p.spinner();
  const results: Array<{ name: string; ok: boolean }> = [];

  // Test Bedrock
  if (authData.aws?.accessKeyId) {
    s.start('Testing Bedrock connection...');
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore — dynamic import, may not be installed
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({
        region: authData.aws.region || 'us-east-1',
        credentials: { accessKeyId: authData.aws.accessKeyId, secretAccessKey: authData.aws.secretAccessKey },
      });
      await client.send(new ConverseCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: [{ text: 'hi' }] }],
        inferenceConfig: { maxTokens: 1 },
      }));
      results.push({ name: 'Bedrock', ok: true });
      s.stop('Bedrock ✓');
    } catch (err: any) {
      // AccessDeniedException means credentials ARE valid, just model not enabled
      const isAccessIssue = err?.name === 'AccessDeniedException' || err?.Code === 'AccessDeniedException';
      if (isAccessIssue) {
        results.push({ name: 'Bedrock', ok: true });
        s.stop('Bedrock ✓ (credentials valid, enable models in AWS console)');
      } else {
        results.push({ name: 'Bedrock', ok: false });
        s.stop('Bedrock ✗ (check credentials later)');
      }
    }
  }

  // Test Telegram
  if (authData.telegram?.botToken) {
    s.start('Testing Telegram bot...');
    try {
      const res = await fetch(`https://api.telegram.org/bot${authData.telegram.botToken}/getMe`);
      const data = await res.json() as { ok: boolean };
      results.push({ name: 'Telegram', ok: data.ok });
      s.stop(data.ok ? 'Telegram ✓' : 'Telegram ✗');
    } catch {
      results.push({ name: 'Telegram', ok: false });
      s.stop('Telegram ✗');
    }
  }

  // ─── Step 6: Save Configuration ─────────────────────
  await ensureDir(wsDir);

  const defaultConfig = GlobalConfigSchema.parse({
    blocksDir: './blocks',
  });
  await writeJson(getConfigPath(), defaultConfig);
  await writeJson(getAuthPath(), authData);

  // ─── Step 7: Install Selected Plugins ────────────────
  const pluginList = Array.isArray(selectedPlugins) ? selectedPlugins as string[] : [];
  if (pluginList.length > 0) {
    const s2 = p.spinner();
    for (const plugin of pluginList) {
      s2.start(`Installing plugin: ${plugin}...`);
      try {
        const { addCommand } = await import('./plugins.js');
        await addCommand(plugin);
        s2.stop(`${plugin} ✓`);
      } catch {
        s2.stop(`${plugin} ✗ (install later with: mblk add ${plugin})`);
      }
    }
  }

  // ─── Done ───────────────────────────────────────────
  console.log('');
  p.note(
    [
      ...results.map(r => `${r.ok ? chalk.green('✓') : chalk.yellow('○')} ${r.name}`),
      ...(results.length === 0 ? [DIM('No connections configured yet')] : []),
      ...(pluginList.length > 0 ? ['', DIM(`Plugins: ${pluginList.join(', ')}`)] : []),
      '',
      DIM(`Workspace: ${wsDir}`),
      DIM(`Config:    ${getConfigPath()}`),
    ].join('\n'),
    'Setup Complete',
  );

  p.outro(
    `Run ${ACCENT('mblk start <name>')} to create your first block.\n` +
    DIM(`  Edit credentials later: ${ACCENT('mblk config auth')}`)
  );
}

// ===== Ollama live setup helper =========================
// State is persisted at ~/.memoryblock/ws/ollama.json so the wizard
// skips the install/pull prompts on subsequent runs.

const OLLAMA_STATE_PATH = join(getWsRoot(), 'ollama.json');
const DEFAULT_TINY_MODEL = 'qwen2.5:0.5b';

interface OllamaState {
    installed: boolean;
    daemonManaged: boolean;
    defaultModel: string;
    installedAt: string;
    lastChecked: string;
}

async function readOllamaState(): Promise<OllamaState | null> {
    const raw = await readJsonSafe<Partial<OllamaState>>(OLLAMA_STATE_PATH, {});
    if (!raw || !raw.installed) return null;
    return {
        installed: !!raw.installed,
        daemonManaged: !!raw.daemonManaged,
        defaultModel: raw.defaultModel || DEFAULT_TINY_MODEL,
        installedAt: raw.installedAt || new Date().toISOString(),
        lastChecked: raw.lastChecked || new Date().toISOString(),
    };
}

async function writeOllamaState(state: OllamaState): Promise<void> {
    await writeJson(OLLAMA_STATE_PATH, state);
}

/**
 * First-time Ollama setup wizard.
 * Detects current state, prompts for install/serve/pull, persists results.
 * Never throws — failures degrade gracefully so `mblk init` always succeeds.
 */
async function setupOllama(nonInteractive: boolean): Promise<void> {
    const s = p.spinner();
    const state = await readOllamaState();

    // Probe current state regardless of persisted state — user may have
    // uninstalled/reset Ollama between runs.
    const installed = await ollamaInstaller.isInstalled();
    const running = installed ? await ollamaInstaller.isRunning() : false;
    const models = running ? await ollamaInstaller.listModels() : [];

    const everythingReady = installed && running && models.length > 0;
    const sameAsLastTime = state && state.installed === installed && state.defaultModel
        && (models.length === 0 || models.includes(state.defaultModel));

    if (everythingReady && sameAsLastTime) {
        p.log.info(`${chalk.green('✓')} Ollama ready · ${models.length} model(s) · default: ${state!.defaultModel}`);
        return;
    }

    p.log.step('Ollama setup');

    // ── Install binary if missing ──
    if (!installed) {
        if (nonInteractive) {
            p.log.warn('Ollama binary not found. Skipping install in non-interactive mode.');
            p.log.warn(DIM('  Install manually: brew install ollama   (macOS)'));
            p.log.warn(DIM('                 or: curl -fsSL https://ollama.com/install.sh | sh   (Linux)'));
            return;
        }
        const proceed = await p.confirm({
            message: 'Ollama is not installed. Download it now? (~47 MB via Homebrew on macOS, official script on Linux)',
            initialValue: true,
        });
        if (p.isCancel(proceed) || !proceed) {
            p.log.warn('Skipped. Install later with: brew install ollama');
            return;
        }
        s.start('Installing Ollama...');
        try {
            await ollamaInstaller.install({
                onProgress: (line) => s.message(line.text),
            });
            s.stop('Ollama installed ✓');
        } catch (err) {
            s.stop('Ollama install failed');
            p.log.warn(`  ${(err as Error).message}`);
            p.log.warn(DIM('  You can install manually and re-run `mblk init`.'));
            return;
        }
    } else {
        const version = await ollamaInstaller.getVersion();
        p.log.info(`${chalk.green('✓')} Ollama ${version || ''} already installed`);
    }

    // ── Ensure daemon is running ──
    const nowRunning = await ollamaInstaller.isRunning();
    if (!nowRunning) {
        if (nonInteractive) {
            p.log.warn('Ollama daemon not running. Start it with: ollama serve');
            return;
        }
        const proceed = await p.confirm({
            message: 'Start the Ollama daemon now? (runs in the background)',
            initialValue: true,
        });
        if (p.isCancel(proceed) || !proceed) {
            p.log.warn('Skipped. Start manually with: ollama serve');
            return;
        }
        s.start('Starting Ollama daemon...');
        try {
            const result = await ollamaInstaller.ensureRunning({
                onProgress: (line) => s.message(line.text),
            });
            s.stop(result.started ? 'Ollama daemon started ✓' : 'Ollama daemon already running ✓');
        } catch (err) {
            s.stop('Could not start Ollama daemon');
            p.log.warn(`  ${(err as Error).message}`);
            return;
        }
    }

    // ── Pull a default model if none installed ──
    const currentModels = await ollamaInstaller.listModels();
    if (currentModels.length === 0) {
        if (nonInteractive) {
            p.log.warn(`No Ollama models pulled. Pull one manually: ollama pull ${DEFAULT_TINY_MODEL}`);
            return;
        }
        const proceed = await p.confirm({
            message: `No models installed. Pull a small default? (${DEFAULT_TINY_MODEL} — ~400 MB, runs on 8 GB RAM)`,
            initialValue: true,
        });
        if (p.isCancel(proceed) || !proceed) {
            p.log.warn(`Skipped. Pull later with: ollama pull ${DEFAULT_TINY_MODEL}`);
        } else {
            s.start(`Pulling ${DEFAULT_TINY_MODEL}...`);
            try {
                await ollamaInstaller.pullModel(DEFAULT_TINY_MODEL, {
                    onProgress: (line) => s.message(line.text),
                });
                s.stop(`${DEFAULT_TINY_MODEL} ready ✓`);
            } catch (err) {
                s.stop('Model pull failed');
                p.log.warn(`  ${(err as Error).message}`);
            }
        }
    } else {
        p.log.info(`${chalk.green('✓')} ${currentModels.length} model(s) available: ${currentModels.slice(0, 5).join(', ')}${currentModels.length > 5 ? '…' : ''}`);
    }

    // ── Persist state for next time ──
    await writeOllamaState({
        installed: true,
        daemonManaged: true,
        defaultModel: currentModels[0] || DEFAULT_TINY_MODEL,
        installedAt: state?.installedAt || new Date().toISOString(),
        lastChecked: new Date().toISOString(),
    });
}