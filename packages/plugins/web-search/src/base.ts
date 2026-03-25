/**
 * Search provider contract.
 * All search providers (Brave, Google, etc.) must implement this.
 */
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface SearchOptions {
    count?: number;
    language?: string;
}

export interface SearchProvider {
    readonly name: string;
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}