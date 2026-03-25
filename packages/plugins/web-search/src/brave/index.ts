import { loadAuth } from 'memoryblock';
import type { SearchProvider, SearchResult, SearchOptions } from '../base.js';

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

interface BraveWebResult {
    title?: string;
    url?: string;
    description?: string;
}

/**
 * Brave Search API provider.
 * Uses native fetch() (Node 18+ built-in).
 */
export class BraveSearchProvider implements SearchProvider {
    readonly name = 'brave';

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
        const auth = await loadAuth();
        const apiKey = auth.brave?.apiKey;

        if (!apiKey) {
            throw new Error(
                'Brave API key not configured. Add it to ~/.memoryblock/auth.json:\n' +
                '  { "brave": { "apiKey": "..." } }',
            );
        }

        const count = options?.count || 5;
        const params = new URLSearchParams({
            q: query,
            count: String(count),
        });

        const response = await fetch(`${BRAVE_API_URL}?${params}`, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { web?: { results?: BraveWebResult[] } };
        const results = data.web?.results || [];

        return results.map((r: BraveWebResult) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.description || '',
        }));
    }
}