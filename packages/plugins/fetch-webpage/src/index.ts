import type { ToolExecutionResult, ToolContext, ToolDefinition } from '@memoryblock/types';

/**
 * fetch_webpage — extract readable content from a URL.
 *
 * Zero external dependencies:
 * - Uses Node.js built-in fetch() (available since Node 18)
 * - HTML→text via regex (no cheerio, no jsdom)
 *
 * Cost-efficient: truncates output at 8000 chars for token control.
 */

const MAX_CONTENT_LENGTH = 8000;
const FETCH_TIMEOUT = 15000;

/**
 * Strip HTML to readable text content.
 * Removes scripts, styles, nav, header, footer, ads, and extracts
 * meaningful text from the page body.
 */
function htmlToText(html: string): string {
    let text = html;

    // Remove script, style, nav, header, footer, aside elements
    text = text.replace(/<(script|style|nav|header|footer|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Convert common HTML elements to readable text
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<\/li>/gi, '\n');

    // Add formatting for headers and links
    text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n');
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');
    text = text.replace(/<li[^>]*>/gi, '• ');

    // Strip remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

    // Clean up whitespace
    text = text.replace(/[ \t]+/g, ' ');         // collapse horizontal whitespace
    text = text.replace(/\n{3,}/g, '\n\n');       // max 2 consecutive newlines
    text = text.replace(/^\s+|\s+$/gm, '');       // trim each line

    return text.trim();
}

/** Extract page title from HTML. */
function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim().replace(/\s+/g, ' ') : '(no title)';
}

/** Extract meta description. */
function extractDescription(html: string): string {
    const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i);
    return match ? match[1].trim() : '';
}

const fetchWebpageDefinition: ToolDefinition = {
    name: 'fetch_webpage',
    description:
        'Fetch a webpage and extract its text content. ' +
        'Returns the page title, description, and cleaned text. ' +
        'Useful for reading articles, documentation, and reference pages. ' +
        'Output is capped at 8000 characters for token efficiency.',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'The URL to fetch.' },
        },
        required: ['url'],
        additionalProperties: false,
    },
    requiresApproval: false,
};

export const fetchWebpageTool = {
    definition: fetchWebpageDefinition,
    async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolExecutionResult> {
        const url = params.url as string;

        if (!url || !url.startsWith('http')) {
            return { content: 'Invalid URL. Must start with http:// or https://.', isError: true };
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'memoryblock/0.1.0 (AI assistant web reader)',
                    'Accept': 'text/html,application/xhtml+xml,text/plain',
                },
            });

            clearTimeout(timeout);

            if (!response.ok) {
                return {
                    content: `Fetch failed: HTTP ${response.status} ${response.statusText}`,
                    isError: true,
                };
            }

            const contentType = response.headers.get('content-type') || '';
            const html = await response.text();

            // If it's plain text or JSON, return as-is (truncated)
            if (!contentType.includes('html')) {
                const truncated = html.slice(0, MAX_CONTENT_LENGTH);
                return {
                    content: truncated + (html.length > MAX_CONTENT_LENGTH ? '\n...(truncated)' : ''),
                    isError: false,
                };
            }

            const title = extractTitle(html);
            const desc = extractDescription(html);
            const text = htmlToText(html);
            const truncated = text.slice(0, MAX_CONTENT_LENGTH);

            const parts = [
                `# ${title}`,
                desc ? `> ${desc}` : '',
                `Source: ${url}`,
                '',
                truncated,
                text.length > MAX_CONTENT_LENGTH ? `\n...(truncated — ${text.length} chars total)` : '',
            ];

            return { content: parts.filter(Boolean).join('\n'), isError: false };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('abort')) {
                return { content: `Fetch timed out after ${FETCH_TIMEOUT / 1000}s: ${url}`, isError: true };
            }
            return { content: `Fetch failed: ${message}`, isError: true };
        }
    },
};

/** Export as array for registry plugin loading. */
export const tools = [fetchWebpageTool];
