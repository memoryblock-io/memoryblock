import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

const MAX_RESPONSE_LENGTH = 10_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export const httpRequestTool: Tool = {
    definition: {
        name: 'http_request',
        description: 'Send a structured HTTP request (GET, POST, PUT, DELETE, PATCH) to a REST API or webhook endpoint. Returns status code, headers, and formatted response body with token-efficient truncation.',
        parameters: createSchema(
            {
                url: { type: 'string', description: 'The target URL (e.g. https://api.example.com/v1/data).' },
                method: {
                    type: 'string',
                    description: 'HTTP method: GET, POST, PUT, DELETE, PATCH. Default: GET.',
                    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                },
                headers: { type: 'string', description: 'JSON string of request headers, e.g. {"Authorization": "Bearer ...", "Content-Type": "application/json"}.' },
                body: { type: 'string', description: 'Request payload body (string or JSON string).' },
                timeoutMs: { type: 'string', description: 'Timeout in milliseconds (default: 20000).' },
            },
            ['url'],
        ),
        requiresApproval: false,
    },
    async execute(params, context): Promise<ToolExecutionResult> {
        const url = params.url as string;
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return {
                content: 'Invalid URL. Must start with http:// or https://',
                isError: true,
            };
        }

        // Permission check
        if (context.permissions && context.permissions.allowNetwork === false) {
            return {
                content: 'Network access denied by block permissions (allowNetwork: false).',
                isError: true,
            };
        }

        const method = ((params.method as string) || 'GET').toUpperCase();
        const timeoutMs = parseInt((params.timeoutMs as string) || String(DEFAULT_TIMEOUT_MS), 10);

        let parsedHeaders: Record<string, string> = {
            'User-Agent': 'memoryblock/0.1.10 (AI Agent HTTP Client)',
        };

        if (params.headers) {
            try {
                const customHeaders = typeof params.headers === 'string'
                    ? JSON.parse(params.headers)
                    : params.headers;
                parsedHeaders = { ...parsedHeaders, ...customHeaders };
            } catch {
                return { content: 'Invalid `headers` JSON string format.', isError: true };
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const reqInit: RequestInit = {
                method,
                headers: parsedHeaders,
                signal: controller.signal,
            };

            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && params.body) {
                reqInit.body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
                if (!parsedHeaders['Content-Type'] && !parsedHeaders['content-type']) {
                    parsedHeaders['Content-Type'] = 'application/json';
                }
            }

            const startTime = Date.now();
            const response = await fetch(url, reqInit);
            const duration = Date.now() - startTime;
            clearTimeout(timer);

            const contentType = response.headers.get('content-type') || '';
            const rawBody = await response.text();

            let formattedBody = rawBody;
            if (contentType.includes('application/json')) {
                try {
                    const parsedJson = JSON.parse(rawBody);
                    formattedBody = JSON.stringify(parsedJson, null, 2);
                } catch { /* use raw */ }
            }

            let truncated = formattedBody;
            let isTruncated = false;
            if (formattedBody.length > MAX_RESPONSE_LENGTH) {
                truncated = formattedBody.slice(0, MAX_RESPONSE_LENGTH);
                isTruncated = true;
            }

            const headerSummary = [
                `HTTP ${response.status} ${response.statusText} (${duration}ms)`,
                `Content-Type: ${contentType || 'unknown'}`,
                `Size: ${rawBody.length} bytes`,
            ].join('\n');

            let output = `### Response\n${headerSummary}\n\n\`\`\`${contentType.includes('json') ? 'json' : 'text'}\n${truncated}\n\`\`\``;
            if (isTruncated) {
                output += `\n\n*(Truncated from ${rawBody.length} bytes for token efficiency)*`;
            }

            return {
                content: output,
                isError: !response.ok,
            };
        } catch (err) {
            clearTimeout(timer);
            const msg = (err as Error).message;
            if (msg.includes('abort')) {
                return { content: `HTTP request timed out after ${timeoutMs / 1000}s: ${url}`, isError: true };
            }
            return { content: `HTTP request failed: ${msg}`, isError: true };
        }
    },
};

export const netTools: Tool[] = [httpRequestTool];
