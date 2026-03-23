/**
 * Agent: Ephemeral worker spawned by the Monitor.
 * Lives in blocks/<name>/agents/<agent-id>/
 * Has its own memory and tool scope.
 *
 * MVP: Placeholder — Monitor can function without agents.
 * Full agent spawning will be implemented post-MVP.
 */
export class Agent {
    readonly id: string;
    readonly role: string;
    readonly agentPath: string;

    constructor(id: string, role: string, agentPath: string) {
        this.id = id;
        this.role = role;
        this.agentPath = agentPath;
    }
}
