#!/usr/bin/env node
import express, { Express } from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { setupAuthRoutes } from './auth/routes.js';
import { getFirstAvailableTokens } from './auth/tokens.js';
import logger from './utils/logger.js';
import { quotaManager } from './utils/quotaManager.js';
import { healthChecker } from './utils/healthCheck.js';
import { GooglePhotosMCPCore } from './mcp/core.js';

// Load environment variables
dotenv.config();

/**
 * HTTP server implementation for Google Photos MCP.
 * Extends GooglePhotosMCPCore and adds HTTP/SSE transport with Express.
 * Includes authentication routes, health checks, and DNS rebinding protection.
 */
class GooglePhotosHTTPServer extends GooglePhotosMCPCore {
  private app: Express;
  private sseTransports = new Map<string, SSEServerTransport>();
  private authCleanup?: () => void;

  constructor() {
    super({
      name: "google-photos-mcp",
      version: "0.1.0",
    });

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Sets up Express middleware including DNS rebinding protection
   */
  private setupMiddleware(): void {
    this.app.use(express.json());

    // DNS rebinding protection (MCP security requirement)
    // Validates Host header to prevent malicious websites from accessing local server
    this.app.use((req, res, next) => {
      const host = req.get('host');
      const allowedHosts = ['localhost:3000', '127.0.0.1:3000', 'localhost', '127.0.0.1'];

      if (host && !allowedHosts.includes(host)) {
        logger.warn(`Rejected request with invalid Host header: ${host}`);
        return res.status(403).send('Forbidden: Invalid Host header');
      }

      next();
    });
  }

  /**
   * Sets up all HTTP routes including auth, SSE, and health checks
   */
  private setupRoutes(): void {
    // Set up authentication routes
    this.authCleanup = setupAuthRoutes(this.app);

    // Home page
    this.app.get('/', (req, res) => {
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
              <div style="background-color: #fff3cd; border-color: #ffeaa7; color: #856404; padding: 15px; border-radius: 4px; margin: 15px 0;">
                <strong>⚠️ Important Notice (2025 API Changes):</strong><br>
                As of March 31, 2025, Google Photos API access is limited to app-created content only.
                This MCP server may have limited functionality with your existing photos.
                For full library access, Google recommends using the Photos Picker API.
              </div>
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

    // SSE endpoint for MCP communication
    this.app.get('/mcp', async (req, res) => {
      try {
        const transport = new SSEServerTransport('/mcp', res);

        // Store the transport by session ID
        const sessionId = transport.sessionId;
        this.sseTransports.set(sessionId, transport);

        // Clean up when the connection closes
        transport.onclose = () => {
          this.sseTransports.delete(sessionId);
        };

        await this.server.connect(transport);
      } catch (error) {
        logger.error(`Error setting up SSE: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).send('Failed to set up SSE connection');
      }
    });

    // Handle POST requests to the SSE endpoint
    this.app.post('/mcp', async (req, res) => {
      try {
        // Get the session ID from the query parameter
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
          return res.status(400).send('Missing sessionId parameter');
        }

        // Get the SSE transport
        const transport = this.sseTransports.get(sessionId);
        if (!transport) {
          return res.status(400).send('No active SSE session with the provided sessionId');
        }

        // Handle the POST message
        await transport.handlePostMessage(req, res);
      } catch (error) {
        logger.error(`Error handling POST: ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      }
    });

    // Health check endpoints
    this.app.get('/health', async (req, res) => {
      const health = await healthChecker.check({ detailed: false });
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json({ status: health.status });
    });

    this.app.get('/health/detailed', async (req, res) => {
      const health = await healthChecker.check({ detailed: true });
      res.json(health);
    });

    this.app.get('/metrics', (req, res) => {
      res.json({
        timestamp: new Date().toISOString(),
        quota: quotaManager.getStats(),
      });
    });
  }

  /**
   * Overrides parent to add resource and prompt handlers (required by HTTP mode)
   */
  protected registerHandlers(): void {
    // Call parent to register tool handlers
    super.registerHandlers();

    // Add resource and prompt handlers (required by spec)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: []
    }));

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: []
    }));
  }

  /**
   * Starts the HTTP server
   */
  async start(port: number = 3000): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        logger.info(`HTTP server running on port ${port}`);
        logger.info(`MCP endpoint available at: http://localhost:${port}/mcp`);
        logger.info(`Visit http://localhost:${port} for the home page`);
        logger.info(`Visit http://localhost:${port}/auth to authenticate with Google Photos`);
        resolve();
      });
    });
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.authCleanup) {
      this.authCleanup();
    }
  }
}

/**
 * Main entry point for the application.
 * Determines the mode (STDIO or HTTP) and starts the appropriate server.
 */
async function main() {
  const useStdio = process.argv.includes('--stdio');

  if (useStdio) {
    // Run in STDIO mode (for Claude Desktop)
    // In STDIO mode, all logging must go to stderr to avoid breaking the MCP protocol
    logger.info('Starting Google Photos MCP server in STDIO mode');

    // Check token existence
    try {
      const tokens = await getFirstAvailableTokens();
      if (!tokens) {
        logger.warn('=================================================================');
        logger.warn('WARNING: No authentication tokens found.');
        logger.warn('To authenticate:');
        logger.warn('1. Start the server in HTTP mode: npm start');
        logger.warn('2. Visit http://localhost:3000/auth in your browser');
        logger.warn('3. Follow the Google OAuth authentication flow');
        logger.warn('4. After authenticating, restart the server in STDIO mode');
        logger.warn('=================================================================');
      } else {
        logger.info('Found valid authentication tokens.');
      }
    } catch (error) {
      logger.error('Error checking tokens:', error);
    }

    // Use the base GooglePhotosMCPCore for STDIO mode
    const core = new GooglePhotosMCPCore({
      name: "google-photos-mcp",
      version: "0.1.0",
    });

    // Register resource and prompt handlers
    core.getServer().setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: []
    }));

    core.getServer().setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: []
    }));

    const transport = new StdioServerTransport();
    await core.getServer().connect(transport);
    logger.info('Google Photos MCP server connected via STDIO');
  } else {
    // Run in HTTP mode
    const httpServer = new GooglePhotosHTTPServer();

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      httpServer.shutdown();
      process.exit(0);
    });

    const port = parseInt(process.env.PORT || '3000', 10);
    await httpServer.start(port);
  }
}

// Handle errors
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`);
  logger.error(error.stack || '');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Run the server
main().catch((error) => {
  logger.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});

export { GooglePhotosHTTPServer };
