/**
 * `mblk providers` — interactive TUI for adapter + auth + model management.
 *
 * Lets the user:
 *   - See which providers are configured (status: ✓ configured / ○ unconfigured)
 *   - Set or rotate API keys for any provider
 *   - Set the AWS region / Ollama baseURL / etc.
 *   - Clear credentials for a provider
 *   - Verify a provider's credentials (probes the actual endpoint)
 *
 * No secrets are echoed. Empty input = no change. Special "clear" sentinel
 * removes a field. Backed by the same `auth.json` file the web UI uses.
 *
 * Run with no args for the interactive menu, or pass a provider id to jump
 * straight to its config:  mblk providers openai
 */
import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
    loadAuth, saveAuth, isInitialized, getAuthPath,
    loadGlobalConfig, saveGlobalConfig,
} from '@memoryblock/core';
import { log } from '@memoryblock/core';
// readFile/writeFile intentionally not used at the top level — handlers imported via adapter-registry

interface ProviderSpec {
    id: string;
    displayName: string;
    hint: string;
    /** Ordered list of credential fields this provider accepts. */
    fields: Array<{
        key: string;
        label: string;
        secret: boolean;
        placeholder?: string;
    }>;
    /** Pre-flight probe to verify credentials. */
    verify?: (auth: Record<string, string>) => Promise<{ ok: boolean; detail: string }>;
}

const PROVIDERS: ProviderSpec[] = [
    {
        id: 'bedrock',
        displayName: 'AWS Bedrock',
        hint: 'Claude + Llama via AWS',
        fields: [
            { key: 'accessKeyId', label: 'Access Key ID', secret: true, placeholder: 'AKIA...' },
            { key: 'secretAccessKey', label: 'Secret Access Key', secret: true },
            { key: 'region', label: 'Region', secret: false, placeholder: 'us-east-1' },
        ],
        verify: async (a) => {
            if (!a.accessKeyId || !a.secretAccessKey) {
                return { ok: false, detail: 'Missing AWS credentials' };
            }
            return { ok: true, detail: `AWS credentials present (region: ${a.region || 'us-east-1'}). Use POST /v1/adapters/bedrock/verify to live-test.` };
        },
    },
    {
        id: 'openai',
        displayName: 'OpenAI',
        hint: 'GPT-4o, GPT-4.1, o1, o3',
        fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-proj-...' }],
    },
    {
        id: 'google',
        displayName: 'Google Gemini',
        hint: 'Gemini 2.5 Pro/Flash',
        fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'AIzaSy...' }],
    },
    {
        id: 'anthropic',
        displayName: 'Anthropic',
        hint: 'Claude API direct',
        fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-ant-...' }],
    },
    {
        id: 'ollama',
        displayName: 'Ollama (local)',
        hint: 'Local model server — no key required',
        fields: [
            { key: 'baseURL', label: 'Base URL', secret: false, placeholder: 'http://localhost:11434/v1' },
        ],
    },
];

const ACCENT = chalk.hex('#7C3AED');
const DIM = chalk.dim;

// ACCENT + DIM are exported via the brand palette for future inline usage.
void ACCENT; void DIM;

function mask(value: string | undefined): string {
    if (!value) return DIM('(unset)');
    if (value.length <= 6) return '••••';
    return `${value.slice(0, 3)}${'•'.repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`;
}

async function showOverview(auth: Record<string, Record<string, string>>): Promise<void> {
    console.log('');
    p.log.step('Provider status');
    for (const prov of PROVIDERS) {
        const rec = auth[prov.id] || {};
        const configured = prov.fields.every((f) => !f.secret || !!rec[f.key]) || (prov.id === 'ollama');
        const status = configured ? chalk.green('✓ configured') : chalk.yellow('○ missing');
        const summary = prov.fields
            .map((f) => {
                const v = rec[f.key];
                if (!v) return DIM(`${f.key}=—`);
                if (f.secret) return DIM(`${f.key}=${mask(v)}`);
                return DIM(`${f.key}=${v}`);
            })
            .join('  ');
        console.log(`  ${status}  ${chalk.bold(prov.displayName).padEnd(16)} ${summary}`);
    }
    console.log('');
    log.dim(`  Auth file: ${getAuthPath()}`);
}

async function configureProvider(
    providerId: string,
    auth: Record<string, Record<string, string>>,
    nonInteractive: boolean,
): Promise<void> {
    const prov = PROVIDERS.find((p) => p.id === providerId);
    if (!prov) {
        log.error(`Unknown provider: ${providerId}`);
        return;
    }

    p.intro(`${prov.displayName} configuration`);

    if (prov.fields.length === 0) {
        p.log.info('This provider has no configurable fields.');
        return;
    }

    const current = auth[prov.id] || {};
    const updates: Record<string, string | null> = {};

    for (const field of prov.fields) {
        const existing = current[field.key];
        const existingDisplay = existing ? (field.secret ? mask(existing) : existing) : DIM('(not set)');

        p.log.info(`${chalk.bold(field.label)}: ${existingDisplay}`);

        if (nonInteractive) {
            continue;
        }

        const action = await p.select({
            message: `What do you want to do with ${field.label}?`,
            options: [
                ...(existing
                    ? [{ value: 'keep', label: 'Keep current value', hint: field.secret ? mask(existing) : existing }]
                    : []),
                { value: 'set', label: existing ? 'Replace value' : 'Set value' },
                ...(existing ? [{ value: 'clear', label: 'Clear this field' }] : []),
            ],
        });

        if (p.isCancel(action)) {
            p.outro('Cancelled.');
            return;
        }

        if (action === 'keep') {
            continue;
        }
        if (action === 'clear') {
            updates[field.key] = null;
            continue;
        }

        // action === 'set' → prompt for new value (masked if secret)
        const value = await p.text({
            message: `Enter new ${field.label}`,
            placeholder: field.placeholder || '',
            validate: (v) => {
                if (field.secret && v && v.length < 8) {
                    return 'Looks too short for a real key. Paste the full value.';
                }
                return;
            },
        });
        if (p.isCancel(value)) {
            p.outro('Cancelled.');
            return;
        }
        if (typeof value === 'string' && value.trim() !== '') {
            updates[field.key] = value.trim();
        }
    }

    if (Object.keys(updates).length === 0) {
        p.log.info('No changes made.');
        p.outro('Done.');
        return;
    }

    // Apply updates
    const next = { ...current };
    for (const [k, v] of Object.entries(updates)) {
        if (v === null) {
            delete next[k];
        } else {
            next[k] = v as string;
        }
    }
    auth[prov.id] = next;
    await saveAuth(auth as any);

    p.log.success(`Saved ${prov.displayName} configuration.`);

    // Optional: verify — offered for every provider since verifyAdapter is safe for all
    const proceed = await p.confirm({
        message: 'Verify credentials now? (probes the actual endpoint)',
        initialValue: true,
    });
        if (!p.isCancel(proceed) && proceed) {
            const s = p.spinner();
            s.start('Verifying…');
            try {
                const { verifyAdapter } = await import('@memoryblock/api/adapter-registry');
                const result = await verifyAdapter(prov.id, {
                    accessKeyId: next.accessKeyId,
                    secretAccessKey: next.secretAccessKey,
                    apiKey: next.apiKey,
                    baseURL: next.baseURL,
                    region: next.region,
                } as any).catch((e: Error) => ({ ok: false, detail: e.message }));
                s.stop(result.ok ? `${chalk.green('✓')} Verified` : `${chalk.red('✗')} Failed`);
                p.log.info(result.detail);
            } catch (err) {
                s.stop('Verify failed');
                p.log.warn((err as Error).message);
            }
        }

    p.outro(`${prov.displayName} is set. Run \`mblk providers\` to review.`);
}

async function clearProvider(
    providerId: string,
    auth: Record<string, Record<string, string>>,
): Promise<void> {
    const prov = PROVIDERS.find((p) => p.id === providerId);
    if (!prov) {
        log.error(`Unknown provider: ${providerId}`);
        return;
    }
    const rec = auth[prov.id];
    if (!rec || Object.keys(rec).length === 0) {
        p.log.info(`${prov.displayName} is already empty.`);
        return;
    }
    const confirm = await p.confirm({
        message: `Clear all ${prov.displayName} credentials?`,
        initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
        p.outro('Cancelled.');
        return;
    }
    delete auth[prov.id];
    await saveAuth(auth as any);
    p.log.success(`${prov.displayName} credentials cleared.`);
    p.outro('Done.');
}

async function setDefaultAdapter(defaults: any, providers: Array<{ value: string; label: string; hint: string }>): Promise<void> {
    const current = defaults?.adapter?.provider || 'bedrock';
    const selected = await p.select({
        message: 'Default adapter (used when a block has no provider set)',
        options: providers,
        initialValue: current,
    });
    if (p.isCancel(selected)) {
        p.outro('Cancelled.');
        return;
    }
    defaults.adapter = defaults.adapter || {};
    defaults.adapter.provider = selected;
    await saveGlobalConfig(defaults);
    p.log.success(`Default adapter set to ${selected}.`);
    p.outro('Done.');
}

export async function providersCommand(target?: string, options?: { nonInteractive?: boolean }): Promise<void> {
    if (!await isInitialized()) {
        log.error('Workspace not initialized. Run `mblk init` first.');
        process.exit(1);
    }

    const auth = (await loadAuth()) as Record<string, Record<string, string>>;
    const globalConfig = await loadGlobalConfig();

    // Direct-target mode: `mblk providers <provider-id>`
    if (target) {
        if (target === 'list' || target === 'show') {
            await showOverview(auth);
            return;
        }
        if (target === 'default') {
            await setDefaultAdapter(globalConfig.defaults, PROVIDERS.map((p) => ({ value: p.id, label: p.displayName, hint: p.hint })));
            return;
        }
        if (target === 'clear' || target.startsWith('--')) {
            const provId = target === 'clear' ? '' : target.replace(/^--/, '');
            if (!provId || !PROVIDERS.find((p) => p.id === provId)) {
                log.error(`Usage: mblk providers clear <provider>`);
                return;
            }
            await clearProvider(provId, auth);
            return;
        }
        if (PROVIDERS.find((p) => p.id === target)) {
            await configureProvider(target, auth, !!options?.nonInteractive);
            return;
        }
        log.error(`Unknown provider: ${target}. Use one of: ${PROVIDERS.map((p) => p.id).join(', ')}`);
        return;
    }

    // Interactive menu
    p.intro('memoryblock providers');
    await showOverview(auth);

    if (options?.nonInteractive) {
        p.outro(`Non-interactive mode. Re-run without --yes to make changes.`);
        return;
    }

    const action = await p.select({
        message: 'What would you like to do?',
        options: [
            { value: 'configure', label: 'Configure a provider', hint: 'set / change API keys' },
            { value: 'default', label: 'Set default adapter', hint: globalConfig.defaults?.adapter?.provider || 'bedrock' },
            { value: 'clear', label: 'Clear a provider\'s credentials' },
            { value: 'list', label: 'Just show overview' },
            { value: 'done', label: 'Done' },
        ],
    });

    if (p.isCancel(action) || action === 'done' || action === 'list') {
        p.outro('Done.');
        return;
    }

    if (action === 'default') {
        await setDefaultAdapter(globalConfig.defaults, PROVIDERS.map((p) => ({ value: p.id, label: p.displayName, hint: p.hint })));
        return;
    }

    const which = await p.select({
        message: action === 'configure' ? 'Which provider to configure?' : 'Which provider to clear?',
        options: PROVIDERS.map((p) => ({
            value: p.id,
            label: p.displayName,
            hint: p.hint,
        })),
    });
    if (p.isCancel(which)) {
        p.outro('Cancelled.');
        return;
    }

    if (action === 'configure') {
        await configureProvider(which, auth, !!options?.nonInteractive);
    } else {
        await clearProvider(which, auth);
    }
}