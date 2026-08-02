/**
 * Provider list + config schema — aiplug-driven, web side.
 *
 * Pulls the full provider list from aiplug's `/v1/providers` endpoint
 * with a small static shortlist as fallback. The field schema for each
 * provider comes from `/v1/providers/:slug`. When the aiplug server
 * is unreachable, a 5-entry static list + a minimal apiKey fallback
 * keep the UI functional.
 *
 * This module deliberately has no memoryblock-provider hardcoding —
 * adding a new provider is a one-line change in aiplug's registry.
 */

/**
 * Static fallback provider list — used when aiplug's `/v1/providers`
 * endpoint is unreachable. The full list is normally pulled at runtime
 * from aiplug's registry (100+ entries); this shortlist keeps the
 * UI functional for offline / first-boot scenarios.
 *
 * Each entry mirrors the aiplug descriptor shape so the same renderer
 * works against both: { id, name, hint }.
 */
const STATIC_PROVIDERS = [
    // Frontier (US/Western)
    { id: 'openai',     name: 'OpenAI',            hint: 'GPT-4, GPT-4o' },
    { id: 'anthropic',  name: 'Anthropic',         hint: 'Claude API direct' },
    { id: 'google',     name: 'Google Gemini',     hint: 'Gemini Pro, Flash' },
    { id: 'xai',        name: 'xAI (Grok)',         hint: 'Grok models' },
    { id: 'mistral',    name: 'Mistral AI',        hint: 'Mistral Large, Mixtral' },
    { id: 'cohere',     name: 'Cohere',            hint: 'Command R+ models' },
    { id: 'perplexity', name: 'Perplexity',        hint: 'Sonar online models' },
    { id: 'deepseek',   name: 'DeepSeek',          hint: 'V3, R1 reasoning' },
    // Chinese frontier
    { id: 'minimax',    name: 'MiniMax',         hint: 'OpenAI + Anthropic compatible; agentic' },
    { id: 'zhipu',      name: 'Z.ai (Zhipu GLM)',  hint: 'GLM-4.5, GLM-5' },
    { id: 'moonshot',   name: 'Moonshot (Kimi)',   hint: 'Kimi K2 multimodal' },
    { id: 'dashscope',  name: 'Alibaba DashScope', hint: 'Qwen 3, Qwen-VL' },
    { id: 'baidu-qianfan', name: 'Baidu Qianfan', hint: 'ERNIE models' },
    { id: 'stepfun',    name: 'StepFun',           hint: 'Step-2, Step-1V' },
    { id: 'xiaomi',     name: 'Xiaomi MiMo',       hint: 'MiMo 7B reasoning' },
    // Cloud (AWS, Azure, GCP, etc.)
    { id: 'bedrock',    name: 'AWS Bedrock (OpenAI compat)', hint: 'Claude, Llama, Nova via AWS' },
    { id: 'bedrock-aws', name: 'AWS Bedrock (native SigV4)', hint: 'Converse + ConverseStream' },
    { id: 'bedrock-converse', name: 'AWS Bedrock (Converse)', hint: 'Alias for bedrock-aws' },
    { id: 'azure-openai', name: 'Azure OpenAI',    hint: 'GPT-4o, Phi-3' },
    { id: 'vertex-ai', name: 'Google Vertex AI',  hint: 'Gemini on GCP' },
    { id: 'databricks', name: 'Databricks',        hint: 'DBRX, hosted models' },
    // Aggregators
    { id: 'openrouter', name: 'OpenRouter',        hint: '200+ models, one key' },
    { id: 'litellm',    name: 'LiteLLM',           hint: 'Local proxy' },
    { id: 'portkey',    name: 'Portkey',           hint: 'AI gateway' },
    { id: 'helicone',   name: 'Helicone',          hint: 'AI gateway + observability' },
    { id: 'requesty',   name: 'Requesty',          hint: 'AI router' },
    // Fast inference
    { id: 'groq',       name: 'Groq',              hint: 'Fast LPU inference' },
    { id: 'cerebras',   name: 'Cerebras',          hint: 'Fast wafer-scale inference' },
    { id: 'sambanova',  name: 'SambaNova',         hint: 'Enterprise fast inference' },
    { id: 'together',   name: 'Together AI',       hint: 'Open models, fast' },
    { id: 'fireworks',  name: 'Fireworks AI',      hint: 'Open models, fast' },
    { id: 'deepinfra', name: 'DeepInfra',         hint: 'Open models, pay-per-token' },
    { id: 'replicate',  name: 'Replicate',         hint: 'Run any open model' },
    // Local
    { id: 'ollama',     name: 'Ollama (local)',    hint: 'Run models locally — no API key' },
    { id: 'ollama-cloud', name: 'Ollama Cloud',   hint: 'Hosted Ollama' },
    { id: 'vllm',       name: 'vLLM',              hint: 'Self-hosted OpenAI server' },
    { id: 'lm-studio', name: 'LM Studio',         hint: 'Local OpenAI-compatible' },
    { id: 'llama-cpp', name: 'llama.cpp',          hint: 'CPU/GPU local inference' },
    { id: 'jan',        name: 'Jan',               hint: 'Local desktop client' },
];

/**
 * Curated shortlist of "important" providers, surfaced in the wizard as
 * the default selection. Keeps the cognitive load small for new users
 * without locking out less-common providers (the full list is always
 * available). Order matters — this is the order they appear in the
 * default selection.
 */
const IMPORTANT_PROVIDERS = [
    'openai',
    'anthropic',
    'google',
    'bedrock-aws',
    'minimax',
    'ollama',
    'deepseek',
    'zhipu',
    'moonshot',
    'xai',
];

let _cache = null;
let _configCache = Object.create(null);

async function fetchJSON(path) {
    const res = await fetch(path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Return the full provider list. Tries the running aiplug server first
 * (which serves 100+ providers); falls back to a 5-entry static list
 * if the server is unreachable.
 */
export async function listProviders() {
    if (_cache) return _cache;
    try {
        const { providers } = await fetchJSON('/v1/providers');
        const mapped = providers
            .filter((p) => !p.isAlias)
            .map((p) => ({
                id: p.slug,
                name: p.displayName,
                hint: p.notes || p.category,
            }));
        if (mapped.length > 0) {
            _cache = mapped;
            return _cache;
        }
    } catch {
        // aiplug server not running — fall through to static list.
    }
    _cache = STATIC_PROVIDERS;
    return _cache;
}

/**
 * Return the auth schema for one provider — the field list the UI form
 * needs to render. Falls back to a minimal apiKey field for unknown
 * providers so the form still works against the static shortlist.
 */
export async function configSchema(slug) {
    if (_configCache[slug]) return _configCache[slug];
    try {
        const { config } = await fetchJSON(`/v1/providers/${encodeURIComponent(slug)}`);
        if (config && Array.isArray(config.fields) && config.fields.length > 0) {
            _configCache[slug] = config;
            return config;
        }
    } catch {
        // Fall through.
    }
    // Minimal fallback: assume apiKey + optional baseURL.
    const fallback = {
        fields: [
            { key: 'apiKey',  label: 'API Key',            kind: 'secret', secret: true,  required: false },
            { key: 'baseURL', label: 'Base URL (optional)', kind: 'url',    secret: false, required: false },
        ],
    };
    _configCache[slug] = fallback;
    return fallback;
}

/** Reset the cache — call this when the user re-enters setup. */
export function resetProviderCache() {
    _cache = null;
    _configCache = Object.create(null);
}

/**
 * Return the curated important-providers list (the wizard's default
 * selection). Pulled from the same aiplug list, filtered by the
 * IMPORTANT_PROVIDERS allowlist above.
 */
export async function importantProviders() {
    const all = await listProviders();
    return all.filter((p) => IMPORTANT_PROVIDERS.includes(p.id));
}

/**
 * Placeholder text for a single field — driven by the schema's `kind`.
 */
export function placeholderFor(field) {
    switch (field.kind) {
        case 'url':     return 'https://api.example.com/v1';
        case 'secret':  return '';
        case 'integer': return '0';
        default:        return '';
    }
}