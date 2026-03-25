import type { ToolExecutionResult, ToolContext } from '@memoryblock/types';
import type { Tool } from '../base.js';
import { createSchema } from '../base.js';

/**
 * send_channel_message tool allows the monitor to proactively dispatch
 * a message to a specific bound channel (e.g. Telegram or CLI), rather
 * than just passively replying to the channel that initiated the turn.
 */
export const dispatchMessageTool: Tool = {
    definition: {
        name: 'send_channel_message',
        description: 'Send a message proactively to a specific active channel (e.g., "telegram" or "cli"). Use this if the founder asks you to send them a message somewhere else.',
        parameters: createSchema(
            {
                channel: { type: 'string', description: 'The exact name of the target channel (e.g., "telegram", "cli").' },
                content: { type: 'string', description: 'The message content to send.' },
            },
            ['channel', 'content'],
        ),
        requiresApproval: false,
    },

    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
        const target = params.channel as string;
        const content = params.content as string;

        if (!context.dispatchMessage) {
            return { content: 'Message dispatching is not supported in the current execution context.', isError: true };
        }

        try {
            await context.dispatchMessage(target, content);
            return {
                content: `Message successfully dispatched proactively to channel: ${target}`,
                isError: false,
            };
        } catch (err) {
            return {
                content: `Failed to dispatch message to channel '${target}': ${(err as Error).message}`,
                isError: true,
            };
        }
    },
};

export const channelTools = [dispatchMessageTool];