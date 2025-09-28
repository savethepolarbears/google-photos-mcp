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
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
// Import the auth routes
import { setupAuthRoutes } from './auth/routes.js';
import { getFirstAvailableTokens, TokenData } from './auth/tokens.js';
import {
  setupOAuthClient,
  searchPhotosByText,
  searchPhotosByLocation,
  listAlbums,
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
  getAlbum,
} from './api/photos.js';
import logger from './utils/logger.js';

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
      resources: {},
      prompts: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'auth_status',
      description: 'Check authentication status with Google Photos',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
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
    {
      name: 'search_photos_by_location',
      description: 'Search for photos based on location name',
      inputSchema: {
        type: 'object',
        properties: {
          locationName: {
            type: 'string',
            description: 'Location name to search for (e.g., "Paris", "New York", "Tokyo")',
          },
          pageSize: {
            type: 'number',
            description: 'Number of results to return (default: 25)',
            default: 25
          },
          pageToken: {
            type: 'string',
            description: 'Token for pagination',
          }
        },
        required: ['locationName'],
      },
    },
    {
      name: 'get_photo',
      description: 'Get details of a specific photo by ID',
      inputSchema: {
        type: 'object',
        properties: {
          photoId: {
            type: 'string',
            description: 'ID of the photo to retrieve',
          },
          includeBase64: {
            type: 'boolean',
            description: 'Whether to include base64-encoded image data (default: false)',
            default: false
          },
          includeLocation: {
            type: 'boolean',
            description: 'Whether to include location data (default: true)',
            default: true
          }
        },
        required: ['photoId'],
      },
    },
    {
      name: 'list_albums',
      description: 'List all photo albums',
      inputSchema: {
        type: 'object',
        properties: {
          pageSize: {
            type: 'number',
            description: 'Number of results to return (default: 20)',
            default: 20
          },
          pageToken: {
            type: 'string',
            description: 'Token for pagination',
          }
        },
      },
    },
    {
      name: 'get_album',
      description: 'Get details of a specific album by ID',
      inputSchema: {
        type: 'object',
        properties: {
          albumId: {
            type: 'string',
            description: 'ID of the album to retrieve',
          }
        },
        required: ['albumId'],
      },
    },
    {
      name: 'list_album_photos',
      description: 'List photos in a specific album',
      inputSchema: {
        type: 'object',
        properties: {
          albumId: {
            type: 'string',
            description: 'ID of the album to retrieve photos from',
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
        required: ['albumId'],
      },
    }
  ],
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Debug authentication
    logger.info(`Handling tool request: ${request.params.name}`);
    
    // Try to get tokens - first for the just authenticated user, then any available
    let tokens: TokenData | null = null;
    
    try {
      // First try most recently authenticated user
      tokens = await getFirstAvailableTokens();
      if (tokens) {
        const tokenOwner = tokens.userEmail || tokens.userId;
        logger.info(`Using available authentication tokens${tokenOwner ? ` for ${tokenOwner}` : ''}`);
      } else {
        logger.warn('No valid tokens found in tokens.json');
      }
    } catch (error) {
      logger.error(`Error getting tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Special case for STDIO mode to provide authentication instructions
    if (!tokens && useStdio) {
      if (request.params.name === 'auth_status') {
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              authenticated: false,
              message: "Not authenticated. Please run the server in HTTP mode and visit http://localhost:3000/auth to authenticate."
            })
          }]
        };
      }
    }
    
    switch (request.params.name) {
      case 'auth_status':
        // Return authentication status
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              authenticated: !!tokens,
              userEmail: tokens?.userEmail,
              userId: tokens?.userId,
              message: tokens
                ? "Authenticated with Google Photos"
                : "Not authenticated. Please visit http://localhost:3000/auth to authenticate."
            })
          }]
        };
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
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // Search photos
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          args.query,
          args.pageSize || 25,
          args.pageToken,
          args.includeLocation !== false
        );
        
        // Format the result
        const photoItems = photos.map(photo => {
          const result: any = {
            id: photo.id,
            filename: photo.filename,
            description: photo.description || '',
            dateCreated: photo.mediaMetadata?.creationTime || '',
            url: photo.baseUrl,
            webUrl: photo.productUrl,
            width: photo.mediaMetadata?.width || '',
            height: photo.mediaMetadata?.height || '',
          };
          
          // Include location data if available
          if (photo.locationData) {
            result.location = {
              latitude: photo.locationData.latitude,
              longitude: photo.locationData.longitude,
              name: photo.locationData.locationName,
              address: photo.locationData.formattedAddress,
              city: photo.locationData.city,
              country: photo.locationData.countryName,
              region: photo.locationData.region,
              approximate: photo.locationData.approximate
            };
          }
          
          return result;
        });
        
        // Return the results
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              query: args.query,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      }
      
      case 'search_photos_by_location': {
        const args = request.params.arguments as {
          locationName: string;
          pageSize?: number;
          pageToken?: string;
        };

        if (!args.locationName) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Missing required parameter: locationName'
          );
        }
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // Search photos using dedicated location helper
        const { photos, nextPageToken } = await searchPhotosByLocation(
          oauth2Client,
          args.locationName,
          args.pageSize || 25,
          args.pageToken
        );
        
        // Format the result
        const photoItems = photos.map(photo => {
          const result: any = {
            id: photo.id,
            filename: photo.filename,
            description: photo.description || '',
            dateCreated: photo.mediaMetadata?.creationTime || '',
            url: photo.baseUrl,
            webUrl: photo.productUrl,
            width: photo.mediaMetadata?.width || '',
            height: photo.mediaMetadata?.height || '',
          };
          
          // Include location data if available
          if (photo.locationData) {
            result.location = {
              latitude: photo.locationData.latitude,
              longitude: photo.locationData.longitude,
              name: photo.locationData.locationName,
              address: photo.locationData.formattedAddress,
              city: photo.locationData.city,
              country: photo.locationData.countryName,
              region: photo.locationData.region,
              approximate: photo.locationData.approximate
            };
          }
          
          return result;
        });
        
        // Return the results
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              locationName: args.locationName,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      }
      
      case 'list_albums': {
        const args = request.params.arguments as {
          pageSize?: number;
          pageToken?: string;
        };
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // List albums
        const { albums, nextPageToken } = await listAlbums(
          oauth2Client,
          args.pageSize || 20,
          args.pageToken
        );
        
        // Format the result
        const albumItems = albums.map(album => ({
          id: album.id,
          title: album.title,
          url: album.productUrl,
          itemsCount: album.mediaItemsCount || '0',
          coverPhotoUrl: album.coverPhotoBaseUrl
        }));
        
        // Return the results
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              count: albumItems.length,
              nextPageToken,
              albums: albumItems,
            }, null, 2)
          }]
        };
      }
      
      case 'get_photo': {
        const args = request.params.arguments as {
          photoId: string;
          includeBase64: boolean;
          includeLocation: boolean;
        };

        if (!args.photoId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Missing required parameter: photoId'
          );
        }
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // Get photo details
        const photo = await getPhoto(
          oauth2Client,
          args.photoId,
          args.includeLocation
        );
        
        // Get base64 image if requested
        let base64Image: string | undefined;
        if (args.includeBase64 && photo.baseUrl) {
          base64Image = await getPhotoAsBase64(photo.baseUrl);
        }
        
        // Format the result
        const result: any = {
          id: photo.id,
          filename: photo.filename,
          description: photo.description || '',
          dateCreated: photo.mediaMetadata?.creationTime || '',
          url: photo.baseUrl,
          webUrl: photo.productUrl,
          width: photo.mediaMetadata?.width || '',
          height: photo.mediaMetadata?.height || '',
        };
        
        // Include location data if available
        if (photo.locationData) {
          result.location = {
            latitude: photo.locationData.latitude,
            longitude: photo.locationData.longitude,
            name: photo.locationData.locationName,
            address: photo.locationData.formattedAddress,
            city: photo.locationData.city,
            country: photo.locationData.countryName,
            region: photo.locationData.region,
            approximate: photo.locationData.approximate
          };
        }
        
        // Include base64-encoded image data if requested
        if (args.includeBase64 && base64Image) {
          result.base64Image = base64Image;
        }
        
        // Return the result
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
      
      case 'get_album': {
        const args = request.params.arguments as {
          albumId: string;
        };

        if (!args.albumId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Missing required parameter: albumId'
          );
        }
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // Get album details
        const album = await getAlbum(
          oauth2Client,
          args.albumId
        );
        
        // Format the result
        const result: any = {
          id: album.id,
          title: album.title,
          url: album.productUrl,
          itemsCount: album.mediaItemsCount || '0',
          coverPhotoUrl: album.coverPhotoBaseUrl
        };
        
        // Return the result
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
      
      case 'list_album_photos': {
        const args = request.params.arguments as {
          albumId: string;
          pageSize?: number;
          pageToken?: string;
          includeLocation?: boolean;
        };

        if (!args.albumId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Missing required parameter: albumId'
          );
        }
        
        // If still no tokens found, prompt for authentication
        if (!tokens) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                error: "Authentication required",
                message: "Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth"
              })
            }]
          };
        }

        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // List album photos using Google Photos album search
        const { photos, nextPageToken } = await listAlbumPhotos(
          oauth2Client,
          args.albumId,
          args.pageSize || 25,
          args.pageToken,
          args.includeLocation !== false
        );
        
        // Format the result
        const photoItems = photos.map(photo => {
          const result: any = {
            id: photo.id,
            filename: photo.filename,
            description: photo.description || '',
            dateCreated: photo.mediaMetadata?.creationTime || '',
            url: photo.baseUrl,
            webUrl: photo.productUrl,
            width: photo.mediaMetadata?.width || '',
            height: photo.mediaMetadata?.height || '',
          };
          
          // Include location data if available
          if (photo.locationData) {
            result.location = {
              latitude: photo.locationData.latitude,
              longitude: photo.locationData.longitude,
              name: photo.locationData.locationName,
              address: photo.locationData.formattedAddress,
              city: photo.locationData.city,
              country: photo.locationData.countryName,
              region: photo.locationData.region,
              approximate: photo.locationData.approximate
            };
          }
          
          return result;
        });
        
        // Return the results
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              albumId: args.albumId,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      }
      
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  } catch (error: unknown) {
    logger.error('[Error]:', error);
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

// Support resources/list and prompts/list methods which are expected by Claude for Desktop
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: []
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: []
}));

// Run the server
async function main() {
  if (useStdio) {
    // Run in STDIO mode (for Claude Desktop)
    logger.info('Starting in STDIO mode');
    
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
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Google Photos MCP server running on stdio');
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
      console.log(`Visit http://localhost:${port} for the home page`);
      console.log(`Visit http://localhost:${port}/auth to authenticate with Google Photos`);
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
