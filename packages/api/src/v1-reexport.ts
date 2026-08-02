/**
 * Sub-path export for the /v1 router. Lets consumers import it as:
 *   import { v1Router } from '@memoryblock/api/v1';
 */
export { v1Router } from './v1/index.js';
export {
    ADAPTER_REGISTRY,
    listAdapters,
    listModelsForAdapter,
    verifyAdapter,
    createAdapter,
    AdapterNotFoundError,
    AdapterConfigError,
    type AdapterId,
    type AdapterInfo,
    type ChatConfig,
    type ChatRequest,
} from './adapter-registry.js';
