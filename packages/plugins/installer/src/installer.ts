import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/** Settings field types supported in plugin manifests. */
export interface SettingsField {
    type: 'text' | 'password' | 'number' | 'select' | 'toggle';
    label: string;
    default?: string | number | boolean;
    placeholder?: string;
    options?: string[];          // For 'select' type
    min?: number;                // For 'number' type
    max?: number;
}

export interface PluginEntry {
    id: string;
    name: string;
    description: string;
    package: string;
    version: string;
    toolNames: string[];
    requiresAuth: string[];
    category: string;
    status?: string;
    core?: boolean;              // Core plugins can't be uninstalled
    blockSpecific?: boolean;     // Plugin can have per-block settings
    settings?: Record<string, SettingsField>;
}

interface PluginRegistry {
    plugins: PluginEntry[];
}

/**
 * Plugin installer — reads from the official registry and manages
 * installation of npm packages + block config updates.
 * Extended with settings storage and core plugin support.
 */
export class PluginInstaller {
    private registry: PluginRegistry | null = null;
    private registryPath: string;

    constructor() {
        // Registry lives alongside this package's compiled output
        const thisDir = dirname(fileURLToPath(import.meta.url));
        this.registryPath = join(thisDir, '..', 'registry', 'plugins.json');
    }

    /** Load the plugin registry. */
    async loadRegistry(): Promise<PluginRegistry> {
        if (this.registry) return this.registry;
        const raw = await readFile(this.registryPath, 'utf-8');
        this.registry = JSON.parse(raw) as PluginRegistry;
        return this.registry;
    }

    /** List all available plugins. */
    async listPlugins(): Promise<PluginEntry[]> {
        const reg = await this.loadRegistry();
        return reg.plugins;
    }

    /** Find a plugin by ID. */
    async findPlugin(id: string): Promise<PluginEntry | undefined> {
        const reg = await this.loadRegistry();
        return reg.plugins.find(p => p.id === id);
    }

    /**
     * Install a plugin:
     * 1. npm install the package
     * 2. Add tool names to the block's config.json if provided
     */
    async install(pluginId: string, options?: { blockConfigPath?: string; cwd?: string; onLog?: (chunk: string) => void }): Promise<{
        success: boolean;
        message: string;
        plugin?: PluginEntry;
    }> {
        const plugin = await this.findPlugin(pluginId);
        if (!plugin) {
            return { success: false, message: `Plugin "${pluginId}" not found in registry.` };
        }

        if (plugin.status === 'upcoming') {
            return { success: false, message: `Plugin "${plugin.name}" is not yet available.` };
        }

        // Install npm package
        const cwd = options?.cwd || process.cwd();
        try {
            await new Promise<void>((resolve, reject) => {
                const child = spawn('npm', ['install', `${plugin.package}@${plugin.version}`], { cwd, shell: true });
                child.stdout.on('data', data => options?.onLog?.(data.toString()));
                child.stderr.on('data', data => options?.onLog?.(data.toString()));
                
                let done = false;
                child.on('error', err => { if (!done) { done = true; reject(err); } });
                child.on('close', code => {
                    if (done) return;
                    done = true;
                    if (code === 0) resolve();
                    else reject(new Error(`Exit code ${code}`));
                });
            });
        } catch (err) {
            return {
                success: false,
                message: `Failed to install ${plugin.package}: ${(err as Error).message}`,
            };
        }

        // Auto-update block config if path provided
        if (options?.blockConfigPath && plugin.toolNames.length > 0) {
            try {
                const configRaw = await readFile(options.blockConfigPath, 'utf-8');
                const config = JSON.parse(configRaw);
                const enabled = config.tools?.enabled || [];

                for (const tool of plugin.toolNames) {
                    if (!enabled.includes(tool)) {
                        enabled.push(tool);
                    }
                }

                config.tools = { ...config.tools, enabled };
                await writeFile(options.blockConfigPath, JSON.stringify(config, null, 4), 'utf-8');
            } catch {
                // Config update is best-effort
            }
        }

        return {
            success: true,
            message: `Installed ${plugin.name} (${plugin.package}@${plugin.version})`,
            plugin,
        };
    }

    /**
     * Remove a plugin:
     * 1. Check if it's a core plugin (can't remove)
     * 2. npm uninstall the package
     * 3. Remove tool names from block config if provided
     */
    async remove(pluginId: string, options?: { blockConfigPath?: string; cwd?: string; onLog?: (chunk: string) => void }): Promise<{
        success: boolean;
        message: string;
    }> {
        const plugin = await this.findPlugin(pluginId);
        if (!plugin) {
            return { success: false, message: `Plugin "${pluginId}" not found in registry.` };
        }

        if (plugin.core) {
            return { success: false, message: `Plugin "${plugin.name}" is a core plugin and cannot be removed.` };
        }

        const cwd = options?.cwd || process.cwd();
        try {
            await new Promise<void>((resolve, reject) => {
                const child = spawn('npm', ['uninstall', plugin.package], { cwd, shell: true });
                child.stdout.on('data', data => options?.onLog?.(data.toString()));
                child.stderr.on('data', data => options?.onLog?.(data.toString()));
                
                let done = false;
                child.on('error', err => { if (!done) { done = true; reject(err); } });
                child.on('close', code => {
                    if (done) return;
                    done = true;
                    if (code === 0) resolve();
                    else reject(new Error(`Exit code ${code}`));
                });
            });
        } catch {
            // Uninstall failure is non-critical
            options?.onLog?.('\nNote: npm uninstall encountered an error, but cleanup will proceed.\n');
        }

        // Clean up block config
        if (options?.blockConfigPath && plugin.toolNames.length > 0) {
            try {
                const configRaw = await readFile(options.blockConfigPath, 'utf-8');
                const config = JSON.parse(configRaw);
                const enabled: string[] = config.tools?.enabled || [];

                config.tools = {
                    ...config.tools,
                    enabled: enabled.filter(t => !plugin.toolNames.includes(t)),
                };
                await writeFile(options.blockConfigPath, JSON.stringify(config, null, 4), 'utf-8');
            } catch {
                // Config cleanup is best-effort
            }
        }

        // Clean up settings
        try {
            const settingsPath = this.pluginSettingsPath(pluginId);
            const { unlink } = await import('node:fs/promises');
            await unlink(settingsPath);
        } catch { /* ignore */ }

        return {
            success: true,
            message: `Removed ${plugin.name} (${plugin.package})`,
        };
    }

    // ===== Settings Storage =====

    /** Get the workspace-level settings file path for a plugin. */
    private pluginSettingsPath(pluginId: string, workspacePath?: string): string {
        const base = workspacePath || process.cwd();
        return join(base, 'plugin-settings', `${pluginId}.json`);
    }

    /** Load settings for a plugin. Returns defaults merged with saved values. */
    async getPluginSettings(pluginId: string, workspacePath?: string): Promise<Record<string, unknown>> {
        const plugin = await this.findPlugin(pluginId);
        if (!plugin?.settings) return {};

        // Start with defaults
        const defaults: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(plugin.settings)) {
            defaults[key] = field.default ?? '';
        }

        // Merge saved values
        try {
            const raw = await readFile(this.pluginSettingsPath(pluginId, workspacePath), 'utf-8');
            const saved = JSON.parse(raw);
            return { ...defaults, ...saved };
        } catch {
            return defaults;
        }
    }

    /** Save settings for a plugin. */
    async savePluginSettings(pluginId: string, values: Record<string, unknown>, workspacePath?: string): Promise<void> {
        const settingsPath = this.pluginSettingsPath(pluginId, workspacePath);
        await mkdir(dirname(settingsPath), { recursive: true });
        await writeFile(settingsPath, JSON.stringify(values, null, 4), 'utf-8');
    }
}
