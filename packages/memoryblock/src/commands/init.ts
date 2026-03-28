import * as p from '@clack/prompts';
import chalk from 'chalk';
import { ensureDir, writeJson } from '@memoryblock/core';
import {
  getWsRoot, getConfigPath, getAuthPath, isInitialized,
} from '@memoryblock/core';
import { GlobalConfigSchema } from '@memoryblock/types';
import { log } from '@memoryblock/core';

import { PROVIDERS, CHANNELS, PLUGINS, PROVIDER_AUTH, CHANNEL_AUTH } from '../constants.js';

// Brand palette — matches web UI CSS vars
const ACCENT = chalk.hex('#7C3AED');  // Primary accent (violet-600)
const DIM = chalk.dim;

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
    authData[provider === 'bedrock' ? 'aws' : provider] = data;
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