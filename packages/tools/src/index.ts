export { ToolRegistry } from './registry.js';
export type { Tool } from './base.js';
export { createSchema } from './base.js';
export { fsTools } from './fs/index.js';
export { shellTools, isSafeCommand } from './shell/index.js';
export { devTools } from './dev/index.js';
export { identityTools } from './core/identity.js';
export { channelTools } from './core/channels.js';

import { ToolRegistry } from './registry.js';
import { fsTools } from './fs/index.js';
import { shellTools } from './shell/index.js';
import { devTools } from './dev/index.js';
import { identityTools } from './core/identity.js';
import { channelTools } from './core/channels.js';

/**
 * Create a ToolRegistry pre-loaded with all built-in tools.
 */
export function createDefaultRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    
    // Core built-in tools
    for (const tool of fsTools) registry.register(tool);
    for (const tool of shellTools) registry.register(tool);
    for (const tool of devTools) registry.register(tool);
    for (const tool of identityTools) registry.register(tool);
    for (const tool of channelTools) registry.register(tool);
    
    return registry;
}
