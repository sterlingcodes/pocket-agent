#!/usr/bin/env node
/**
 * MCP Server for Scheduler Tools
 *
 * This runs as a child process and communicates via stdio JSON-RPC
 * with the Claude Agent SDK.
 */

import { createInterface } from 'readline';

// Types for MCP protocol
interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// Tool definitions
const TOOLS = [
  {
    name: 'schedule_task',
    description: `Create a scheduled task or reminder that runs on a cron schedule.

Use this when the user asks to:
- Set a reminder
- Schedule a recurring task
- Create an automated check

Cron format: "minute hour day month weekday"
Examples:
- "0 9 * * *" = Daily at 9 AM
- "0 9 * * 1-5" = Weekdays at 9 AM
- "*/30 * * * *" = Every 30 minutes
- "0 9 * * 1" = Every Monday at 9 AM

Channels: "desktop" (notification), "telegram" (if configured)`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique task name' },
        schedule: { type: 'string', description: 'Cron expression' },
        prompt: { type: 'string', description: 'What to do when triggered' },
        channel: { type: 'string', description: 'desktop or telegram' },
      },
      required: ['name', 'schedule', 'prompt'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks and reminders',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name to delete' },
      },
      required: ['name'],
    },
  },
];

// In-memory storage for tasks (will be synced with main process via IPC)
const tasks: Map<string, { name: string; schedule: string; prompt: string; channel: string }> = new Map();

// Handle tool calls
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  console.error(`[MCP Scheduler] Tool call: ${name}`, JSON.stringify(args));

  switch (name) {
    case 'schedule_task': {
      const { name: taskName, schedule, prompt, channel } = args as {
        name: string;
        schedule: string;
        prompt: string;
        channel?: string;
      };

      // Validate cron expression (basic check)
      const cronParts = schedule.split(' ');
      if (cronParts.length !== 5) {
        return JSON.stringify({ error: 'Invalid cron expression. Format: "minute hour day month weekday"' });
      }

      // Store task (in production, this would call the main process)
      tasks.set(taskName, { name: taskName, schedule, prompt, channel: channel || 'desktop' });

      // Send to parent process for actual scheduling
      process.send?.({ type: 'create_task', task: { name: taskName, schedule, prompt, channel: channel || 'desktop' } });

      return JSON.stringify({
        success: true,
        message: `Task "${taskName}" scheduled: ${schedule}`,
        note: 'Task will run at the specified time and send response to ' + (channel || 'desktop'),
      });
    }

    case 'list_scheduled_tasks': {
      // Request from parent
      process.send?.({ type: 'list_tasks' });

      // Return current known tasks
      const taskList = Array.from(tasks.values());
      return JSON.stringify({
        success: true,
        count: taskList.length,
        tasks: taskList,
        note: taskList.length === 0 ? 'No scheduled tasks yet' : undefined,
      });
    }

    case 'delete_scheduled_task': {
      const { name: taskName } = args as { name: string };

      if (tasks.has(taskName)) {
        tasks.delete(taskName);
        process.send?.({ type: 'delete_task', name: taskName });
        return JSON.stringify({ success: true, message: `Task "${taskName}" deleted` });
      } else {
        return JSON.stringify({ success: false, error: `Task "${taskName}" not found` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// MCP protocol handler
function handleRequest(request: MCPRequest): MCPResponse {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pocket-agent-scheduler', version: '1.0.0' },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };

      // Handle async tool call
      handleToolCall(name, args || {}).then((result) => {
        const response: MCPResponse = {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: result }] },
        };
        console.log(JSON.stringify(response));
      });

      // Return immediately with pending (SDK will wait for actual response)
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Processing...' }] } };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// Listen for messages from parent process
process.on('message', (msg: { type: string; tasks?: unknown[] }) => {
  if (msg.type === 'tasks_list' && msg.tasks) {
    tasks.clear();
    for (const task of msg.tasks as Array<{ name: string; schedule: string; prompt: string; channel: string }>) {
      tasks.set(task.name, task);
    }
  }
});

// Main loop - read JSON-RPC from stdin
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const request = JSON.parse(line) as MCPRequest;
    const response = handleRequest(request);
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error('[MCP Scheduler] Parse error:', error);
  }
});

console.error('[MCP Scheduler] Server started');
