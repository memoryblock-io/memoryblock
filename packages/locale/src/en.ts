/**
 * English locale — default language for memoryblock.
 *
 * To add a new language:
 * 1. Copy this file to `<lang>.ts` (e.g., `fr.ts`, `ja.ts`)
 * 2. Translate all string values (keep function signatures identical)
 * 3. Register in `index.ts`
 *
 * Template strings use function params for dynamic values.
 * Keep the exact same param names and types.
 */
export const en = {

    // ─── General ────────────────────────────────────
    general: {
        notInitialized: 'Not initialized. Run `mblk init` first.',
        noBlocksDir: 'No blocks directory found. Create a block with `mblk create <name>`.',
        noBlocksFound: 'No blocks found. Create one with `mblk create <name>`.',
    },

    // ─── Block Lifecycle ────────────────────────────
    block: {
        notFound: (name: string) => `Block "${name}" not found. Run \`mblk create ${name}\` first.`,
        alreadyExists: (name: string, path: string) => `Block "${name}" already exists at ${path}`,
        alreadyRunning: (name: string) => `Block "${name}" is already running.`,
        singleInstanceHint: 'Each block can only run as one instance at a time.',
        stopHint: (name: string) => `Stop it first with: mblk stop ${name}`,
        staleLockRecovered: 'Recovered from stale lock (previous session crashed).',
        created: (name: string) => `Block "${name}" created.`,
        startWith: (name: string) => `Start with: mblk start ${name}`,
        invalidName: 'Block name must start with a letter/number and contain only lowercase letters, numbers, and hyphens (max 32 chars).',
        createdConfig: 'Created config.json',
        createdPulse: 'Created pulse.json',
        createdMemory: 'Created memory.md',
        createdMonitor: 'Created monitor.md',
        path: (path: string) => `Path: ${path}`,
    },

    // ─── Monitor ────────────────────────────────────
    monitor: {
        shuttingDown: 'Shutting down...',
        goingToSleep: 'Going to sleep.',
        currentSession: 'Current Session',
        completeSession: 'Complete Session',
        online: 'Online. Listening...',
        memoryThreshold: 'Memory threshold. Smart-saving context...',
        error: (msg: string) => `Monitor error: ${msg}`,
    },

    // ─── Status ─────────────────────────────────────
    status: {
        noActive: 'No active blocks.',
        archived: (count: number) => `📦 ${count} archived`,
        restoreHint: 'Restore with: mblk restore <name>',
        invalidConfig: 'invalid config',
    },

    // ─── Stop ───────────────────────────────────────
    stop: {
        noBlocksDir: 'No blocks directory found. Nothing to stop.',
        noActive: 'No active blocks to stop.',
        notFound: (name: string) => `Block "${name}" not found.`,
        alreadySleeping: (name: string) => `${name}: already sleeping`,
        stoppedDaemon: (name: string) => `${name}: stopped (daemon process killed)`,
        stopped: (name: string) => `${name}: stopped`,
    },

    // ─── Delete / Archive / Restore ─────────────────
    archive: {
        success: (name: string) => `Block "${name}" archived safely.`,
        location: (path: string) => `Location: ${path}`,
        restoreCmd: (name: string) => `To restore: mblk restore ${name}`,
        deleteCmd: (name: string) => `To permanently delete: mblk delete ${name} --hard`,
        hardDeleteSuccess: (name: string) => `"${name}" permanently deleted.`,
        hardDeleteArchiveSuccess: (name: string) => `"${name}" permanently deleted from archive.`,
        mustUseHard: 'Archived blocks must be deleted permanently using the --hard flag.',
        notFoundBlock: (name: string) => `Block "${name}" not found. Run \`mblk status\` to see available blocks.`,
        notFoundArchive: (name: string) => `No archive found for "${name}". Run \`mblk status\` to check archives.`,
        notFoundEither: (name: string) => `Block or archive "${name}" not found.`,
        multipleFound: (name: string) => `Multiple archives found for "${name}". Which one?`,
        restoreSuccess: (name: string) => `Block "${name}" restored successfully.`,
        restoreConflict: (name: string) => `Cannot restore: A block named "${name}" already exists. Delete or rename it first.`,
    },

    // ─── Onboarding / Setup ─────────────────────────
    setup: {
        title: (name: string) => `Block Setup — ${name}`,
        needsConfig: 'This block needs to be configured before it can start.',
        configMethod: 'How would you like to configure this block?',
        copyFrom: (name: string, detail: string) => `Copy from "${name}" ${detail}`,
        startFresh: 'Start fresh',
        startFreshHint: 'choose provider, model, and skills',
        selectProvider: 'Select your LLM provider:',
        selectModel: 'Select a model:',
        fetchingModels: (provider: string) => `Fetching ${provider} models...`,
        noModelsFound: 'No models found. Check your API credentials.',
        skillsPlugins: 'Skills & Plugins',
        selectSkills: 'Select Skills & Plugins to enable:',
        configComplete: 'Block configured. Starting...',
        cancelledSetup: 'Setup cancelled.',
        copiedSettings: (source: string) => `Copied settings from "${source}".`,
    },

    // ─── Init Wizard ────────────────────────────────
    init: {
        welcome: 'memoryblock setup',
        selectProvider: 'Which LLM provider will you use?',
        enterApiKey: (key: string) => `Enter your ${key}:`,
        verifyingConnection: 'Verifying connection...',
        connectionSuccess: 'Connected successfully.',
        connectionFailed: 'Connection failed. Check your credentials.',
        selectChannel: 'Select communication channels:',
        selectPlugins: 'Select Skills & Plugins to enable:',
        firstBlockName: 'Name your first block:',
        setupComplete: 'Setup complete!',
    },

    // ─── Plugins ─────────────────────────────────────
    plugins: {
        header: 'Skills & Plugins',
        installed: 'Installed',
        available: 'Available',
        added: (name: string) => `Plugin "${name}" added.`,
        removed: (name: string) => `Plugin "${name}" removed.`,
        installerNotAvailable: 'Plugin installer not available. Install @memoryblock/plugin-installer.',
        installerNotAvailableShort: 'Plugin installer not available.',
        specifyId: 'Specify a plugin ID: mblk remove <id>',
        installing: (id: string) => `installing ${id}...`,
        removing: (id: string) => `removing ${id}...`,
        noConfigurable: 'No plugins with configurable settings.',
        runSettings: 'Run `mblk settings <plugin-id>` to configure.',
        pluginNotFound: (id: string) => `Plugin "${id}" not found.`,
        noSettings: (name: string) => `Plugin "${name}" has no configurable settings.`,
    },

    // ─── Permissions ────────────────────────────────
    permissions: {
        scopeBlock: 'block     — access only this block\'s directory',
        scopeWorkspace: 'workspace — access the entire workspace',
        scopeSystem: 'system    — unrestricted file and shell access',
        invalidScope: (scope: string) => `Invalid scope: "${scope}". Use: block, workspace, or system.`,
        updated: (name: string) => `Permissions updated for "${name}".`,
    },

    // ─── Server ─────────────────────────────────────
    server: {
        alreadyRunning: (pid: number, port?: string) => `Server already running (PID ${pid}${port ? `, port ${port}` : ''}).`,
        startedDaemon: (pid: number) => `Server started as daemon (PID ${pid}).`,
        daemonStopHint: '`mblk server stop` to shut down.',
        daemonFailed: 'Failed to spawn daemon process.',
        failedToLoad: (msg: string) => `Failed to load API package: ${msg}`,
        webUiNotFound: 'Web UI package not found. API-only mode.',
        running: 'server running. ctrl+c to stop.',
        serverFailed: (msg: string) => `Server failed: ${msg}`,
        stoppedPort: (port: string | number) => `Server on port ${port} stopped (via port lookup).`,
        noPidFound: 'No server PID found. Server may not be running.',
        stalePid: 'Server process not found (stale PID). Cleaning up.',
        stopped: (pid: number) => `Server stopped (PID ${pid}).`,
        processGone: 'Server process already gone. Cleaning up.',
        stopFailed: (msg: string) => `Failed to stop server: ${msg}`,
        statusNotRunning: 'Status: not running',
        statusRunning: 'Status: running',
        statusStalePid: 'Status: not running (stale PID file)',
        url: (port: string | number) => `http://localhost:${port}`,
    },

    // ─── Shutdown / Restart ─────────────────────────
    lifecycle: {
        stoppingBlocks: 'Stopping all blocks...',
        stoppingServer: 'Stopping server...',
        everythingStopped: 'Everything shut down.',
        startingServer: 'Starting server...',
    },

    // ─── Channels ───────────────────────────────────
    channels: {
        cli: {
            helpLine1: 'type a message and press enter. ctrl+c to exit.',
            helpLine2: 'commands: /status, /create-block <name>',
        },
        telegram: {
            isOnline: (name: string) => `${name} is now online.`,
            isOffline: (name: string) => `${name} is now offline.`,
            anotherInstance: 'Telegram: another instance took over. Disconnecting...',
            anotherRunning: 'Telegram: another instance is running. Disconnecting gracefully...',
            botError: (msg: string) => `Telegram bot error: ${msg}`,
            pollingStopped: (msg: string) => `Telegram polling stopped: ${msg}`,
            noToken: 'Telegram bot token not configured. Add it to ~/.memoryblock/ws/auth.json:\n  { "telegram": { "botToken": "...", "chatId": "..." } }',
        },
    },

    // ─── Errors ─────────────────────────────────────
    errors: {
        unexpected: (msg: string) => `Unexpected error: ${msg}`,
        failedToLoad: (what: string, msg: string) => `Failed to load ${what}: ${msg}`,
        failedToDelete: (msg: string) => `Failed to delete: ${msg}`,
        failedToArchive: (msg: string) => `Failed to archive block: ${msg}`,
        failedToRestore: (msg: string) => `Failed to restore block: ${msg}`,
        monitorFailed: (msg: string) => `Monitor failed: ${msg}`,
    },
};

export type Locale = typeof en;
