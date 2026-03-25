import type { LLMAdapter, LLMMessage, LLMResponse, ToolDefinition } from '@memoryblock/types';

/**
 * Base adapter interface re-exported from core types.
 * All LLM adapters must implement this contract.
 *
 * Usage:
 *   const adapter: LLMAdapter = new BedrockAdapter({ model: '...' });
 *   const response = await adapter.converse(messages, tools);
 */
export type { LLMAdapter, LLMMessage, LLMResponse, ToolDefinition };