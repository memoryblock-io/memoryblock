// Utilities
export {
    atomicWrite,
    writeJson,
    readJson,
    readJsonSafe,
    readTextSafe,
    ensureDir,
    pathExists,
} from './utils/fs.js';

export {
    getHome,
    getConfigPath,
    getAuthPath,
    isInitialized,
    loadGlobalConfig,
    saveGlobalConfig,
    loadAuth,
    saveAuth,
    loadBlockConfig,
    saveBlockConfig,
    loadPulseState,
    savePulseState,
    resolveBlocksDir,
    resolveBlockPath,
} from './utils/config.js';

// Logger
export { log } from './cli/logger.js';

// Engine
export { Monitor } from './engine/monitor.js';
export { MemoryManager } from './engine/memory.js';
export { Gatekeeper } from './engine/gatekeeper.js';
export { Agent } from './engine/agent.js';

// Locale
export { t, setLocale, registerLocale } from '@memoryblock/locale';