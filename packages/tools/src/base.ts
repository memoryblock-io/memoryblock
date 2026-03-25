import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@memoryblock/types';

/**
 * Base Tool interface. All built-in and plugin tools must implement this.
 */
export interface Tool {
    readonly definition: ToolDefinition;
    execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult>;
}

/**
 * Helper to create a JSON Schema object for tool parameters.
 */
export function createSchema(
    properties: Record<string, { type: string; description: string; enum?: string[] }>,
    required: string[] = [],
): Record<string, unknown> {
    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    };
}