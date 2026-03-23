import { log } from '../logger.js';

const INSTALLER_PKG = '@memoryblock/plugin-installer';

export async function addCommand(pluginId: string): Promise<void> {
    let installer: any;
    try {
        const pkg = await import(INSTALLER_PKG);
        installer = new pkg.PluginInstaller();
    } catch {
        log.error('Plugin installer not available. Install @memoryblock/plugin-installer.');
        process.exit(1);
    }

    // Show available if no ID
    if (!pluginId) {
        const plugins = await installer.listPlugins();
        log.brand('Skills & Plugins\n');

        // Check installed status for each plugin
        const rows: Array<{ id: string; name: string; status: string; installed: boolean }> = [];
        for (const p of plugins) {
            let installed = false;
            try {
                require.resolve(p.package, { paths: [process.cwd()] });
                installed = true;
            } catch { /* ignore */ }
            rows.push({
                id: p.id,
                name: p.name,
                status: p.status === 'upcoming' ? 'upcoming' : 'available',
                installed,
            });
        }

        // Table header
        const colId = 16, colName = 24, colStatus = 12;
        const header = `  ${'ID'.padEnd(colId)}${'Name'.padEnd(colName)}${'Status'.padEnd(colStatus)}Installed`;
        const separator = `  ${'─'.repeat(colId)}${'─'.repeat(colName)}${'─'.repeat(colStatus)}${'─'.repeat(9)}`;
        console.log(header);
        console.log(separator);

        for (const row of rows) {
            const installedMark = row.installed ? '  ✓' : '  ·';
            const statusLabel = row.status === 'upcoming' ? 'upcoming' : 'ready';
            console.log(`  ${row.id.padEnd(colId)}${row.name.padEnd(colName)}${statusLabel.padEnd(colStatus)}${installedMark}`);
        }
        console.log('');
        return;
    }

    log.dim(`  installing ${pluginId}...`);
    const result = await installer.install(pluginId);

    if (result.success) {
        log.success(result.message);
        if (result.plugin?.requiresAuth?.length) {
            log.dim(`  requires: ${result.plugin.requiresAuth.join(', ')}`);
        }
    } else {
        log.warn(result.message);
    }
}

export async function removeCommand(pluginId: string): Promise<void> {
    if (!pluginId) {
        log.error('Specify a plugin ID: mblk remove <id>');
        process.exit(1);
    }

    let installer: any;
    try {
        const pkg = await import(INSTALLER_PKG);
        installer = new pkg.PluginInstaller();
    } catch {
        log.error('Plugin installer not available.');
        process.exit(1);
    }

    log.dim(`  removing ${pluginId}...`);
    const result = await installer.remove(pluginId);

    if (result.success) {
        log.success(result.message);
    } else {
        log.error(result.message);
        process.exit(1);
    }
}
