import type { ToolExecutionResult, ToolContext, ToolDefinition } from 'memoryblock';
import { BraveSearchProvider } from './brave/index.js';

export type { SearchProvider, SearchResult, SearchOptions } from './base.js';
export { BraveSearchProvider } from './brave/index.js';

const braveProvider = new BraveSearchProvider();

/**
 * Web search tool definition — registers as a tool in the registry.
 */
const webSearchToolDefinition: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs, and snippets.',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The search query.' },
            count: { type: 'number', description: 'Number of results (default: 5, max: 10).' },
        },
        required: ['query'],
        additionalProperties: false,
    },
    requiresApproval: false,
};

/** Web search tool — usable by the tool registry. */
export const webSearchTool = {
    definition: webSearchToolDefinition,
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolExecutionResult> {
        try {
            const query = params.query as string;
            const count = Math.min((params.count as number) || 5, 10);
            const results = await braveProvider.search(query, { count });

            if (results.length === 0) {
                return { content: 'No results found.', isError: false };
            }

            const formatted = results
                .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
                .join('\n\n');

            return { content: formatted, isError: false };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: `Web search failed: ${message}`, isError: true };
        }
    },
};

/** Export as array for registry plugin loading. */
export const tools = [webSearchTool];
