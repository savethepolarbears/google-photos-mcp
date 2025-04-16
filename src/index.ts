#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
// Import the auth routes
import { setupAuthRoutes } from './auth/routes.js';

// Load environment variables
dotenv.config();

// Create the MCP server instance
const server = new Server(
  {
    name: "google-photos-mcp",
    version: "0.1.0",
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
      name: 'search_photos',
      description: 'Search for photos based on text queries',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for photos (e.g., "vacation 2023", "sunset photos", "cats")',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results to return (default: 25)',
            default: 25
          },
          pageToken: {
            type: 'string',
            description: 'Token for pagination',
          },
          includeLocation: {
            type: 'boolean',
            description: 'Whether to include location data (default: true)',
            default: true
          }
        },
        required: ['query'],
      },
    },
    // Add more tools here as needed
  ],
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case 'search_photos': {
        const args = request.params.arguments as {
          query: string;
          pageSize?: number;
          pageToken?: string;
          includeLocation?: boolean;
        };

        if (!args.query) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Missing required parameter: query'
          );
        }

        // This is just a placeholder - we'll implement the actual Google Photos API integration later
        return {
          content: [
            { 
              type: "text", 
              text: `Searched for "${args.query}" with pageSize=${args.pageSize || 25}, includeLocation=${args.includeLocation !== false}. This is a placeholder response.` 
            }
          ]
        };
      }
      
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  } catch (error: unknown) {
    console.error('[Error]:', error);
    if (error instanceof McpError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to execute tool: ${error.message}`
      );
    }
    throw error;
  }
});

// Check if using STDIO mode
const useStdio = process.argv.includes('--stdio');

// Store active SSE transports
const sseTransports = new Map<string, SSEServerTransport>();

// Run the server
async function main() {
  if (useStdio) {
    // Run in STDIO mode (for Claude Desktop)
    console.error('Starting in STDIO mode');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Google Photos MCP server running on stdio');
  } else {
    // Run as HTTP server (for web integration / Cursor IDE)
    const app = express();
    
    // Middleware
    app.use(cors());
    app.use(express.json());
    
    // Set up authentication routes
    setupAuthRoutes(app);
    
    // Add root route for the home page
    app.get('/', (req, res) => {
      res.send(`
        <html>
          <head>
            <title>Google Photos MCP Server</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
              .container { background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
              h1 { color: #2c3e50; }
              .btn { 
                display: inline-block; 
                background-color: #4285F4; 
                color: white; 
                text-decoration: none; 
                padding: 10px 20px; 
                border-radius: 4px; 
                font-weight: bold;
                margin-top: 10px;
              }
              .btn:hover { background-color: #357ae8; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Google Photos MCP Server</h1>
              <p>Welcome to the Google Photos MCP Server. This service allows AI assistants like Claude to access and work with your Google Photos library.</p>
              <p>To get started, you need to authenticate with Google Photos:</p>
              <a href="/auth" class="btn">Authenticate with Google Photos</a>
            </div>
            <div class="container">
              <h2>Usage</h2>
              <p>After authentication, you can use this server with:</p>
              <ul>
                <li><strong>Claude Desktop:</strong> Configure as a custom MCP server</li>
                <li><strong>Cursor IDE:</strong> Add as an MCP server in the MCP panel</li>
              </ul>
              <p>The MCP endpoint is available at: <code>http://localhost:3000/mcp</code></p>
            </div>
          </body>
        </html>
      `);
    });
    
    // Set up SSE endpoint
    app.get('/mcp', async (req, res) => {
      try {
        const transport = new SSEServerTransport('/mcp', res);
        
        // Store the transport by session ID
        const sessionId = transport.sessionId;
        sseTransports.set(sessionId, transport);
        
        // Clean up when the connection closes
        transport.onclose = () => {
          sseTransports.delete(sessionId);
        };
        
        await server.connect(transport);
      } catch (error) {
        console.error('Error setting up SSE:', error);
        res.status(500).send('Failed to set up SSE connection');
      }
    });
    
    // Handle POST requests to the SSE endpoint
    app.post('/mcp', async (req, res) => {
      try {
        // Get the session ID from the query parameter
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
          return res.status(400).send('Missing sessionId parameter');
        }
        
        // Get the SSE transport
        const transport = sseTransports.get(sessionId);
        if (!transport) {
          return res.status(400).send('No active SSE session with the provided sessionId');
        }
        
        // Handle the POST message
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error('Error handling POST:', error);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      }
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
    
    // Start HTTP server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`MCP endpoint available at: http://localhost:${port}/mcp`);
    });
  }
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error(`Uncaught exception: ${error.message}`);
  console.error(error.stack || '');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Run the server
main().catch((error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
