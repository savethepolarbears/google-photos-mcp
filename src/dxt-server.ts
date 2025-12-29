#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { GooglePhotosMCPCore } from './mcp/core.js';

dotenv.config();

const DXT_TIMEOUT = 30000; // 30 seconds timeout for DXT operations

/**
 * Server implementation for Google Photos MCP in STDIO mode with DXT timeout support.
 * Extends GooglePhotosMCPCore and adds timeout management for tool execution.
 * Designed to work with clients like Claude Desktop and Cursor IDE via STDIO transport.
 */
class GooglePhotosDXTServer extends GooglePhotosMCPCore {
  private timeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Initializes the Google Photos DXT server.
   * Calls parent constructor and registers handlers with timeout wrapper.
   */
  constructor() {
    super({
      name: "google-photos-mcp",
      version: "0.1.0",
    });
  }

  /**
   * Overrides parent to add timeout wrapper around CallToolRequest handler.
   * Wraps tool execution with a 30-second timeout to prevent hanging in DXT mode.
   */
  protected registerHandlers(): void {
    // Register list tools handler from parent
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));

    // Register call tool handler with DXT timeout wrapper
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const requestId = `${Date.now()}-${Math.random()}`;

      try {
        // Set up timeout for this request
        const timeoutPromise = new Promise<never>((_, reject) => {
          const timeout = setTimeout(() => {
            reject(new McpError(
              ErrorCode.InternalError,
              `Tool execution timeout after ${DXT_TIMEOUT}ms`
            ));
          }, DXT_TIMEOUT);
          this.timeouts.set(requestId, timeout);
        });

        // Execute the tool with timeout protection (using parent's handleCallTool)
        const resultPromise = this.handleCallTool(request);
        const result = await Promise.race([resultPromise, timeoutPromise]);

        // Clean up timeout
        this.clearTimeout(requestId);

        return result;
      } catch (error) {
        // Clean up timeout on error
        this.clearTimeout(requestId);

        logger.error(`[DXT Error] Tool: ${request.params.name}`, error);

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

    // Resource and prompt handlers (required by DXT spec)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: []
    }));

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: []
    }));
  }

  /**
   * Clears the timeout associated with a request ID.
   *
   * @param requestId - The ID of the request to clear timeout for.
   */
  private clearTimeout(requestId: string): void {
    const timeout = this.timeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(requestId);
    }
  }

  /**
   * Starts the server in STDIO mode.
   * Connects via StdioServerTransport.
   */
  async start(): Promise<void> {
    try {
      logger.info('[DXT] Starting Google Photos MCP Server in STDIO mode');

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('[DXT] Google Photos MCP server running on stdio');
    } catch (error) {
      logger.error('[DXT] Failed to start server:', error);
      throw error;
    }
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  logger.error(`[DXT] Uncaught exception: ${error.message}`);
  logger.error(error.stack || '');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[DXT] Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Start the DXT server
async function main() {
  const server = new GooglePhotosDXTServer();
  await server.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error(`[DXT] Failed to start server: ${error.message}`);
    process.exit(1);
  });
}

export { GooglePhotosDXTServer };
