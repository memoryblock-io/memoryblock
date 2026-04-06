import type { Tool } from '@memoryblock/tools';
import { createAgentTool } from './tools/create-agent.js';
import { listAgentsTool } from './tools/list-agents.js';
import { queryAgentTool } from './tools/query-agent.js';
import { terminateAgentTool } from './tools/terminate-agent.js';
import { messageAgentTool } from './tools/message-agent.js';

export const tools: Tool[] = [
    createAgentTool,
    listAgentsTool,
    queryAgentTool,
    terminateAgentTool,
    messageAgentTool
];