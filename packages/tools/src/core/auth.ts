import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolExecutionResult } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

function getWsRoot(): string {
    return process.env.MEMORYBLOCK_WS_DIR || join(homedir(), '.memoryblock', 'ws');
}

export const authReadTool: Tool = {
    definition: {
        name: 'auth_read',
        description: 'Read the presence of configured auth providers. Does not return secret keys.',
        parameters: createSchema({}, []),
        requiresApproval: false
    },
    async execute(): Promise<ToolExecutionResult> {
        try {
            const authPath = join(getWsRoot(), 'auth.json');
            const raw = await fsp.readFile(authPath, 'utf8').catch(() => '{}');
            const auth = JSON.parse(raw);
            const providers = Object.keys(auth).map(k => `- ${k}`);
            if (providers.length === 0) return { content: 'No auth providers configured yet.', isError: false };
            return { content: `Configured providers:\n${providers.join('\n')}`, isError: false };
        } catch (err) {
            return { content: `Failed to read auth: ${(err as Error).message}`, isError: true };
        }
    }
};

export const authWriteTool: Tool = {
    definition: {
        name: 'auth_write',
        description: 'Write credentials to centrally manage APIs. Superblock permission required.',
        parameters: createSchema({
            service: { type: 'string', description: 'Provider name (e.g. "aws", "openai")' },
            credentials: { type: 'string', description: 'JSON-stringified object of credentials' }
        }, ['service', 'credentials']),
        requiresApproval: true,
        requiredScope: 'system' // Superblock only
    },
    async execute(params: Record<string, unknown>): Promise<ToolExecutionResult> {
        const { service, credentials } = params as { service: string, credentials: string };
        try {
            const authPath = join(getWsRoot(), 'auth.json');
            const raw = await fsp.readFile(authPath, 'utf8').catch(() => '{}');
            const auth = JSON.parse(raw);

            auth[service] = { ...(auth[service] || {}), ...JSON.parse(credentials) };
            
            await fsp.writeFile(authPath, JSON.stringify(auth, null, 2), 'utf8');
            return { content: `Successfully updated credentials for '${service}'.`, isError: false };
        } catch (err) {
            return { content: `Failed to write auth: ${(err as Error).message}`, isError: true };
        }
    }
};

export const listAuthProvidersTool: Tool = {
    definition: {
        name: 'list_auth_providers',
        description: 'List supported auth provider schemas.',
        parameters: createSchema({}, []),
        requiresApproval: false
    },
    async execute(): Promise<ToolExecutionResult> {
        return {
            content: `Supported Auth schemas:\n- "aws" ({ accessKeyId, secretAccessKey, region })\n- "openai" ({ apiKey })\n- "gemini" ({ apiKey })\n- "anthropic" ({ apiKey })\n- "telegram" ({ botToken, chatId })\n- "brave" ({ apiKey })`,
            isError: false
        };
    }
};

export const authTools: Tool[] = [authReadTool, authWriteTool, listAuthProvidersTool];
