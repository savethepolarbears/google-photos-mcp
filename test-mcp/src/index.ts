#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Create server instance
const server = new Server(
  {
    name: 'test-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'hello_world',
      description: 'Returns a greeting message',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name to greet',
          },
        },
        required: ['name'],
      },
    },
  ],
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name !== 'hello_world') {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }

    const args = request.params.arguments as { name: string };
    
    if (!args.name) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: name'
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${args.name}! This is a test MCP server.`,
        },
      ],
    };
  } catch (error: unknown) {
    console.error('[Error]:', error);
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute tool: ${error.message}`
      );
    }
    throw error;
  }
});

// Run the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Test MCP server running on stdio');
}

main().catch(console.error); 