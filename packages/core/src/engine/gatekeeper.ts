import type { Channel, ApprovalRequest } from '@memoryblock/types';
import { log } from '../utils/logger.js';

/**
 * Gatekeeper: The sovereign human approval system.
 * When a tool requires approval (e.g., shell commands), execution pauses
 * and the system requests explicit human approval via the active channel.
 */
export class Gatekeeper {
    private channel: Channel;
    private blockName: string;
    private monitorName: string;

    constructor(channel: Channel, blockName: string, monitorName: string) {
        this.channel = channel;
        this.blockName = blockName;
        this.monitorName = monitorName;
    }

    /**
     * Request human approval for a tool execution.
     * Returns true if approved, false if denied.
     */
    async requestApproval(
        toolName: string,
        toolInput: Record<string, unknown>,
    ): Promise<boolean> {
        const description = this.formatDescription(toolName, toolInput);

        const request: ApprovalRequest = {
            toolName,
            toolInput,
            description,
            blockName: this.blockName,
            monitorName: this.monitorName,
        };

        log.system(this.blockName, `Approval required: ${description}`);

        return this.channel.requestApproval(request);
    }

    /** Format a human-readable description of the action. */
    private formatDescription(toolName: string, input: Record<string, unknown>): string {
        if (toolName === 'execute_command') {
            return `Run command: ${input.command}`;
        }
        const params = Object.entries(input)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(', ');
        return `${toolName}(${params})`;
    }
}