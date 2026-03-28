import * as p from '@clack/prompts';
import { log } from '@memoryblock/core';

/**
 * mblk settings <plugin> — view/edit plugin settings via CLI.
 * Auto-generates forms from the plugin's settings schema.
 */
export async function pluginSettingsCommand(pluginId?: string): Promise<void> {
    let installer: any;
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — optional runtime dependency, not needed at compile time
        const mod = await import('@memoryblock/plugin-installer');
        installer = new mod.PluginInstaller();
    } catch {
        log.error('Plugin installer not available.');
        process.exit(1);
    }

    const plugins = await installer.listPlugins();

    // No plugin specified — list all plugins with settings
    if (!pluginId) {
        const withSettings = plugins.filter((pl: any) => pl.settings && Object.keys(pl.settings).length > 0);

        if (withSettings.length === 0) {
            log.dim('  No plugins with configurable settings.');
            return;
        }

        log.brand('plugin settings\n');
        for (const pl of withSettings) {
            const fields = Object.keys(pl.settings).length;
            console.log(`  ${pl.core ? '●' : '○'} ${pl.name} (${pl.id}) — ${fields} setting${fields > 1 ? 's' : ''}`);
        }
        console.log('');
        log.dim('  Run `mblk settings <plugin-id>` to configure.');
        return;
    }

    // Find the plugin
    const plugin = plugins.find((pl: any) => pl.id === pluginId);
    if (!plugin) {
        log.error(`Plugin "${pluginId}" not found.`);
        process.exit(1);
    }

    if (!plugin.settings || Object.keys(plugin.settings).length === 0) {
        log.dim(`  Plugin "${plugin.name}" has no configurable settings.`);
        return;
    }

    // Load current values
    const current = await installer.getPluginSettings(pluginId);

    p.intro(`${plugin.name} Settings`);

    const updates: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(plugin.settings) as [string, any][]) {
        const currentVal = current[key];

        if (field.type === 'select') {
            const result = await p.select({
                message: field.label,
                options: (field.options || []).map((o: string) => ({
                    value: o,
                    label: o,
                    hint: o === currentVal ? 'current' : undefined,
                })),
                initialValue: currentVal || field.default,
            });
            if (p.isCancel(result)) { p.outro('Cancelled.'); return; }
            updates[key] = result;
        } else if (field.type === 'toggle') {
            const result = await p.confirm({
                message: field.label,
                initialValue: currentVal ?? field.default ?? false,
            });
            if (p.isCancel(result)) { p.outro('Cancelled.'); return; }
            updates[key] = result;
        } else if (field.type === 'number') {
            const result = await p.text({
                message: `${field.label} (${field.min ?? ''}–${field.max ?? ''})`,
                defaultValue: String(currentVal ?? field.default ?? ''),
                placeholder: String(field.default ?? ''),
                validate: (v: string | undefined) => {
                    const n = parseInt(v || '', 10);
                    if (isNaN(n)) return 'Must be a number';
                    if (field.min !== undefined && n < field.min) return `Min: ${field.min}`;
                    if (field.max !== undefined && n > field.max) return `Max: ${field.max}`;
                },
            });
            if (p.isCancel(result)) { p.outro('Cancelled.'); return; }
            updates[key] = parseInt(String(result), 10);
        } else {
            // text / password
            const result = await p.text({
                message: field.label,
                defaultValue: String(currentVal ?? field.default ?? ''),
                placeholder: field.placeholder || '',
            });
            if (p.isCancel(result)) { p.outro('Cancelled.'); return; }
            updates[key] = result;
        }
    }

    // Save
    await installer.savePluginSettings(pluginId, updates);
    p.outro(`Settings saved for ${plugin.name}.`);
}