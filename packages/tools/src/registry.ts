import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@memoryblock/types';
import { log } from '@memoryblock/core';
import type { Tool } from './base.js';
import { ToolSandbox } from './sandbox.js';

/**
 * Central tool registry. Manages built-in tools and dynamically loaded plugin tools.
 * Implements the LIST_TOOLS_AVAILABLE discovery pattern for token optimization.
 * All execution passes through ToolSandbox for permission enforcement.
 */
export class ToolRegistry {
    private tools = new Map<string, Tool>();

    /** Register a tool. */
    register(tool: Tool): void {
        this.tools.set(tool.definition.name, tool);
    }

    /** Check if a tool exists. */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /** Get all tool definitions (for LIST_TOOLS_AVAILABLE). */
    listTools(): ToolDefinition[] {
        return Array.from(this.tools.values()).map((t) => t.definition);
    }

    /**
     * Get the LIST_TOOLS_AVAILABLE meta-tool definition.
     * This is the only tool exposed to the LLM on first contact.
     */
    getDiscoveryTool(): ToolDefinition {
        return {
            name: 'list_tools_available',
            description: 'Discover all tools available to you. Call this first to see your capabilities.',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            requiresApproval: false,
        };
    }

    /**
     * Execute a tool by name. 
     * All calls pass through ToolSandbox BEFORE execution.
     * Implements graceful degradation — never throws.
     */
    async execute(
        name: string,
        params: Record<string, unknown>,
        context: ToolContext,
    ): Promise<ToolExecutionResult> {
        // Handle the meta-tool
        if (name === 'list_tools_available') {
            const tools = this.listTools();
            const scope = context.permissions?.scope || 'block';
            const hasShell = context.permissions?.allowShell || scope === 'system';

            const available: string[] = [];
            const restricted: string[] = [];

            for (const t of tools) {
                const needsScope = t.requiredScope || 'block';
                const needsShell = t.requiresShell || false;
                const scopeOrder = { block: 0, workspace: 1, system: 2 };
                const hasSufficientScope = scopeOrder[scope] >= scopeOrder[needsScope];
                const hasShellAccess = !needsShell || hasShell;

                if (hasSufficientScope && hasShellAccess) {
                    available.push(`- **${t.name}**: ${t.description}`);
                } else {
                    const reason = needsShell && !hasShell ? 'requires shell access' : `requires scope: ${needsScope}`;
                    restricted.push(`- ~~${t.name}~~ *(${reason})*`);
                }
            }

            let listing = `Your scope: **${scope}** | Shell: **${hasShell ? 'yes' : 'no'}**\n\n`;
            listing += `## Available (${available.length})\n${available.join('\n')}\n`;

            if (restricted.length > 0) {
                listing += `\n## Restricted (${restricted.length})\n${restricted.join('\n')}`;
                listing += `\n\n*To unlock restricted tools, ask the user to run: \`mblk superblock ${context.blockName}\`*`;
            }

            return {
                content: listing,
                isError: false,
            };
        }

        const tool = this.tools.get(name);
        if (!tool) {
            // Graceful degradation — never crash
            return {
                content: `Tool "${name}" not found. Use list_tools_available to see available tools.`,
                isError: true,
            };
        }

        // ===== SANDBOX GATE =====
        // Validate BEFORE execution. If denied, the tool never runs.
        const denied = ToolSandbox.validate(name, params, context);
        if (denied) {
            return denied;
        }

        try {
            return await tool.execute(params, context);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: `Tool "${name}" failed: ${message}`,
                isError: true,
            };
        }
    }

    /**
     * Load plugin tools from a dynamic import path.
     * Uses try/catch for graceful degradation — never crashes if plugin is missing.
     */
    async loadPlugin(pluginPath: string): Promise<void> {
        try {
            const mod = await import(pluginPath);
            if (mod.tools && Array.isArray(mod.tools)) {
                for (const tool of mod.tools as Tool[]) {
                    this.register(tool);
                }
            } else if (mod.default && typeof mod.default === 'object' && 'definition' in mod.default) {
                this.register(mod.default as Tool);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn(`Failed to load plugin "${pluginPath}": ${message}`);
        }
    }
}