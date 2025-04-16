import { McpServer } from '@modelcontextprotocol/sdk';
import { stdioTransport, sseTransport } from '@modelcontextprotocol/sdk';
import express from 'express';
import cors from 'cors';
import path from 'path';
import config from './utils/config';
import logger from './utils/logger';
import { registerTools } from './tools';
import { setupAuthRoutes } from './auth/routes';

async function main() {
  // Check if using STDIO mode
  const useStdio = process.argv.includes('--stdio');
  
  // Create the MCP server
  const server = new McpServer({
    name: config.mcp.name,
    version: config.mcp.version,
  });
  
  // Register all tools
  registerTools(server);
  
  if (useStdio) {
    // Run in STDIO mode (for Claude Desktop)
    logger.info('Starting in STDIO mode');
    await stdioTransport(server);
  } else {
    // Run as HTTP server (for web integration / Cursor IDE)
    const app = express();
    
    // Middleware
    app.use(cors());
    app.use(express.json());
    
    // Set up authentication routes
    setupAuthRoutes(app);
    
    // Set up MCP server endpoint
    app.use('/mcp', sseTransport(server));
    
    // Serve static files from the views directory
    app.use(express.static(path.join(__dirname, 'views')));
    
    // Home page
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'index.html'));
    });
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
    
    // Start HTTP server
    app.listen(config.server.port, () => {
      logger.info(`Server running on port ${config.server.port}`);
      logger.info(`MCP endpoint available at: http://localhost:${config.server.port}/mcp`);
      logger.info(`Auth endpoint available at: http://localhost:${config.server.port}/auth`);
    });
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
