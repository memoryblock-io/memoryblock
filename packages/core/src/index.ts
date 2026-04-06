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
    getWsRoot,
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
export { log } from './utils/logger.js';

// Engine
export { Monitor } from './engine/monitor.js';
export { MemoryManager } from './engine/memory.js';
export { Gatekeeper } from './engine/gatekeeper.js';
export { PulseEngine } from './engine/pulse.js';
export { Agent } from './engine/agent.js';
export { FILE_TEMPLATES, SYSTEM_PROMPTS } from './engine/prompts.js';

// Locale
export { t, setLocale, registerLocale } from '@memoryblock/locale';