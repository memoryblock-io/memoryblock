import {
    BedrockRuntimeClient,
    type BedrockRuntimeClientConfig,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { loadAuth } from '@memoryblock/core';

export interface AwsClientOptions {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}

// Singleton client per region:accessKey — avoids Bun HTTP/2 keep-alive reconnect failures
const clientCache = new Map<string, BedrockRuntimeClient>();

/**
 * Create (or return cached) BedrockRuntimeClient.
 * Forces HTTP/1.1 via NodeHttpHandler to sidestep Bun's HTTP/2 connection drop bug.
 * Reads credentials from ~/.memoryblock/auth.json — fully self-contained.
 */
export async function createBedrockClient(overrides?: AwsClientOptions): Promise<BedrockRuntimeClient> {
    const auth = await loadAuth();
    const aws = auth.aws;

    const accessKeyId = overrides?.accessKeyId || aws?.accessKeyId;
    const secretAccessKey = overrides?.secretAccessKey || aws?.secretAccessKey;
    const region = overrides?.region || aws?.region || 'us-east-1';

    if (!accessKeyId || !secretAccessKey) {
        throw new Error(
            'AWS credentials not configured. Add your credentials to ~/.memoryblock/auth.json:\n' +
            '  { "aws": { "accessKeyId": "...", "secretAccessKey": "...", "region": "us-east-1" } }',
        );
    }

    const cacheKey = `${region}:${accessKeyId}`;
    if (clientCache.has(cacheKey)) {
        return clientCache.get(cacheKey)!;
    }

    const config: BedrockRuntimeClientConfig = {
        region,
        credentials: { accessKeyId, secretAccessKey },
        // Force HTTP/1.1 — Bun drops HTTP/2 connections between requests
        requestHandler: new NodeHttpHandler({
            connectionTimeout: 5000,
            requestTimeout: 60000,
        }),
    };

    const client = new BedrockRuntimeClient(config);
    clientCache.set(cacheKey, client);
    return client;
}

export { BedrockRuntimeClient };