/**
 * @memoryblock/plugin-installer — single-command plugin management.
 * 
 * `mblk add web-search` — installs the plugin + adds tools to block config
 * `mblk remove web-search` — uninstalls the plugin + removes tools from config
 */

export { PluginInstaller, type PluginEntry, type SettingsField } from './installer.js';
