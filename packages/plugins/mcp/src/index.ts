import type { ToolExecutionResult, ToolContext, ToolDefinition } from '@memoryblock/types';
import { McpClient, type McpTool } from './client.js';

export { McpClient } from './client.js';

// Connection pool for active MCP servers
const activeServers = new Map<string, McpClient>();

function getServerClient(command: string, args: string[] = [], cwd?: string): McpClient {
    const key = `${command}::${args.join(' ')}`;
    let client = activeServers.get(key);
    if (!client) {
        client = new McpClient(command, args, {}, cwd);
        activeServers.set(key, client);
    }
    return client;
}

// ===== mcp_list_tools =====
export const mcpListToolsDefinition: ToolDefinition = {
    name: 'mcp_list_tools',
    description: 'Discover and list tools exposed by an external Model Context Protocol (MCP) server (e.g. PostgreSQL, GitHub, SQLite, Docker, etc.).',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command to spawn the MCP server (e.g. `npx -y @modelcontextprotocol/server-postgres`).' },
            args: { type: 'string', description: 'Space-separated arguments or JSON array of arguments for the command.' },
        },
        required: ['command'],
        additionalProperties: false,
    },
    requiresApproval: true,
    requiresShell: true,
};

export const mcpListToolsTool = {
    definition: mcpListToolsDefinition,
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
        const command = params.command as string;
        let args: string[] = [];

        if (params.args) {
            if (typeof params.args === 'string') {
                try {
                    const parsed = JSON.parse(params.args);
                    args = Array.isArray(parsed) ? parsed.map(String) : params.args.split(' ');
                } catch {
                    args = (params.args as string).split(' ');
                }
            }
        }

        try {
            const client = getServerClient(command, args, context.workingDir || context.blockPath);
            const tools: McpTool[] = await client.listTools();

            if (tools.length === 0) {
                return { content: `MCP server "${command}" returned 0 tools.`, isError: false };
            }

            const formatted = tools.map((t) => {
                const desc = t.description ? ` - ${t.description}` : '';
                return `### \`${t.name}\`${desc}\n\`\`\`json\n${JSON.stringify(t.inputSchema || {}, null, 2)}\n\`\`\``;
            }).join('\n\n');

            return {
                content: `Discovered ${tools.length} MCP tool(s) from \`${command}\`:\n\n${formatted}`,
                isError: false,
            };
        } catch (err) {
            return {
                content: `Failed to list MCP tools from "${command}": ${(err as Error).message}`,
                isError: true,
            };
        }
    },
};

// ===== mcp_call_tool =====
export const mcpCallToolDefinition: ToolDefinition = {
    name: 'mcp_call_tool',
    description: 'Execute a tool on an external Model Context Protocol (MCP) server.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command for the MCP server.' },
            args: { type: 'string', description: 'Arguments for the MCP server command.' },
            toolName: { type: 'string', description: 'Name of the tool to execute on the MCP server.' },
            toolArgs: { type: 'string', description: 'Arguments object or JSON string for the MCP tool.' },
        },
        required: ['command', 'toolName'],
        additionalProperties: false,
    },
    requiresApproval: true,
    requiresShell: true,
};

export const mcpCallToolTool = {
    definition: mcpCallToolDefinition,
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
        const command = params.command as string;
        const toolName = params.toolName as string;
        let args: string[] = [];

        if (params.args) {
            if (typeof params.args === 'string') {
                try {
                    const parsed = JSON.parse(params.args);
                    args = Array.isArray(parsed) ? parsed.map(String) : params.args.split(' ');
                } catch {
                    args = (params.args as string).split(' ');
                }
            }
        }

        let toolArgs: Record<string, unknown> = {};
        if (params.toolArgs) {
            if (typeof params.toolArgs === 'string') {
                try {
                    toolArgs = JSON.parse(params.toolArgs);
                } catch {
                    return { content: 'Invalid `toolArgs` JSON string.', isError: true };
                }
            } else if (typeof params.toolArgs === 'object' && params.toolArgs !== null) {
                toolArgs = params.toolArgs as Record<string, unknown>;
            }
        }

        try {
            const client = getServerClient(command, args, context.workingDir || context.blockPath);
            const result = await client.callTool(toolName, toolArgs);

            const textParts = (result.content || [])
                .map((item) => item.text || (item.data ? `[Data: ${item.mimeType || 'binary'}]` : ''))
                .filter(Boolean);

            const content = textParts.length > 0 ? textParts.join('\n') : '(Tool returned no content)';

            return {
                content,
                isError: result.isError || false,
            };
        } catch (err) {
            return {
                content: `MCP tool execution failed: ${(err as Error).message}`,
                isError: true,
            };
        }
    },
};

export const tools = [mcpListToolsTool, mcpCallToolTool];
