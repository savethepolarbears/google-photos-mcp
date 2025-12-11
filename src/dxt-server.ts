#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { getFirstAvailableTokens, TokenData } from './auth/tokens.js';
import { setupOAuthClient, searchPhotosByText, listAlbums, getPhoto, getPhotoAsBase64, getAlbum } from './api/photos.js';
import logger from './utils/logger.js';

dotenv.config();

const DXT_TIMEOUT = 30000; // 30 seconds timeout for DXT operations

/**
 * Server implementation for the Google Photos MCP (Model Context Protocol).
 * This class handles tool registration, execution, and communication via STDIO.
 * It is designed to work with clients like Claude Desktop and Cursor IDE.
 */
class GooglePhotosDXTServer {
  private server: Server;
  private timeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Initializes the Google Photos MCP server.
   * Sets up the MCP server instance and registers tool handlers.
   */
  constructor() {
    this.server = new Server(
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

    this.setupHandlers();
  }

  /**
   * Sets up request handlers for the MCP server.
   * Registers:
   * - ListToolsRequestSchema: Defines available tools.
   * - CallToolRequestSchema: Handles tool execution requests.
   * - ListResourcesRequestSchema: (Empty) Required by spec.
   * - ListPromptsRequestSchema: (Empty) Required by spec.
   */
  private setupHandlers() {
    // Tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
                default: 25,
                minimum: 1,
                maximum: 100
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
                default: 25,
                minimum: 1,
                maximum: 100
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
                default: 20,
                minimum: 1,
                maximum: 100
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
                default: 25,
                minimum: 1,
                maximum: 100
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

    // Tool execution with timeout management
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

        // Execute the tool with timeout protection
        const resultPromise = this.executeTool(request);
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
  private clearTimeout(requestId: string) {
    const timeout = this.timeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(requestId);
    }
  }

  /**
   * Executes a specific tool request.
   * Handles authentication, validation, and dispatches to the appropriate API function.
   *
   * @param request - The tool execution request containing tool name and arguments.
   * @returns A Promise resolving to the tool execution result.
   * @throws McpError if tool is not found, authentication fails, or execution fails.
   */
  private async executeTool(request: any) {
    logger.info(`[DXT] Executing tool: ${request.params.name}`);
    
    // Get authentication tokens
    let tokens: TokenData | null = null;
    
    try {
      tokens = await getFirstAvailableTokens();
      if (tokens) {
        logger.info('[DXT] Using available authentication tokens');
      } else {
        logger.warn('[DXT] No valid tokens found');
      }
    } catch (error) {
      logger.error(`[DXT] Error getting tokens: ${error instanceof Error ? error.message : String(error)}`);
    }

    switch (request.params.name) {
      case 'auth_status':
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              authenticated: !!tokens,
              status: tokens ? "authenticated" : "not_authenticated",
              message: tokens 
                ? "Successfully authenticated with Google Photos" 
                : "Not authenticated. Please run authentication setup first.",
              instructions: !tokens ? {
                steps: [
                  "1. Extract the DXT extension to a local directory",
                  "2. Run 'npm start' in the extension directory",
                  "3. Visit http://localhost:3000/auth in your browser",
                  "4. Complete Google OAuth authentication",
                  "5. The extension will be ready to use"
                ]
              } : undefined
            }, null, 2)
          }]
        };

      case 'search_photos': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          query: { type: 'string', required: true },
          pageSize: { type: 'number', default: 25, min: 1, max: 100 },
          pageToken: { type: 'string' },
          includeLocation: { type: 'boolean', default: true }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          args.query,
          args.pageSize,
          args.pageToken,
          args.includeLocation
        );
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              query: args.query,
              count: photos.length,
              nextPageToken,
              photos: photos.map(this.formatPhoto),
            }, null, 2)
          }]
        };
      }

      case 'search_photos_by_location': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          locationName: { type: 'string', required: true },
          pageSize: { type: 'number', default: 25, min: 1, max: 100 },
          pageToken: { type: 'string' }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          `location:${args.locationName}`,
          args.pageSize,
          args.pageToken,
          true
        );
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              locationName: args.locationName,
              count: photos.length,
              nextPageToken,
              photos: photos.map(this.formatPhoto),
            }, null, 2)
          }]
        };
      }

      case 'get_photo': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          photoId: { type: 'string', required: true },
          includeBase64: { type: 'boolean', default: false },
          includeLocation: { type: 'boolean', default: true }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const photo = await getPhoto(oauth2Client, args.photoId, args.includeLocation);
        
        let base64Image: string | undefined;
        if (args.includeBase64 && photo.baseUrl) {
          base64Image = await getPhotoAsBase64(photo.baseUrl);
        }
        
        const result = this.formatPhoto(photo);
        if (base64Image) {
          result.base64Image = base64Image;
        }
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      case 'list_albums': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          pageSize: { type: 'number', default: 20, min: 1, max: 100 },
          pageToken: { type: 'string' }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const { albums, nextPageToken } = await listAlbums(
          oauth2Client,
          args.pageSize,
          args.pageToken
        );
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              count: albums.length,
              nextPageToken,
              albums: albums.map(album => ({
                id: album.id,
                title: album.title,
                url: album.productUrl,
                itemsCount: album.mediaItemsCount || '0',
                coverPhotoUrl: album.coverPhotoBaseUrl
              })),
            }, null, 2)
          }]
        };
      }

      case 'get_album': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          albumId: { type: 'string', required: true }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const album = await getAlbum(oauth2Client, args.albumId);
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              id: album.id,
              title: album.title,
              url: album.productUrl,
              itemsCount: album.mediaItemsCount || '0',
              coverPhotoUrl: album.coverPhotoBaseUrl
            }, null, 2)
          }]
        };
      }

      case 'list_album_photos': {
        if (!tokens) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            'Authentication required. Please authenticate with Google Photos first.'
          );
        }

        const args = this.validateArgs(request.params.arguments, {
          albumId: { type: 'string', required: true },
          pageSize: { type: 'number', default: 25, min: 1, max: 100 },
          pageToken: { type: 'string' },
          includeLocation: { type: 'boolean', default: true }
        });

        const oauth2Client = setupOAuthClient(tokens);
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          args.albumId,
          args.pageSize,
          args.pageToken,
          args.includeLocation
        );
        
        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({
              albumId: args.albumId,
              count: photos.length,
              nextPageToken,
              photos: photos.map(this.formatPhoto),
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
  }

  /**
   * Validates arguments against a schema.
   * Checks types, required fields, and range constraints.
   *
   * @param args - The arguments object to validate.
   * @param schema - The schema defining validation rules.
   * @returns The validated arguments with defaults applied.
   * @throws McpError if validation fails.
   */
  private validateArgs(args: any, schema: Record<string, any>): any {
    const result: any = {};
    
    for (const [key, config] of Object.entries(schema)) {
      const value = args?.[key];
      
      if (config.required && (value === undefined || value === null)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Missing required parameter: ${key}`
        );
      }
      
      if (value !== undefined && value !== null) {
        if (config.type === 'string' && typeof value !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Parameter ${key} must be a string`
          );
        }
        if (config.type === 'number' && typeof value !== 'number') {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Parameter ${key} must be a number`
          );
        }
        if (config.type === 'boolean' && typeof value !== 'boolean') {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Parameter ${key} must be a boolean`
          );
        }
        if (config.min !== undefined && value < config.min) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Parameter ${key} must be at least ${config.min}`
          );
        }
        if (config.max !== undefined && value > config.max) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Parameter ${key} must be at most ${config.max}`
          );
        }
        
        result[key] = value;
      } else if (config.default !== undefined) {
        result[key] = config.default;
      }
    }
    
    return result;
  }

  /**
   * Formats a raw photo object from the API into a simplified structure.
   *
   * @param photo - The raw photo object.
   * @returns The formatted photo object.
   */
  private formatPhoto(photo: any): any {
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
  }

  /**
   * Starts the server.
   * Connects via StdioServerTransport.
   */
  async start() {
    try {
      logger.info('[DXT] Starting Google Photos MCP Server in STDIO mode');
      
      // Check authentication status
      try {
        const tokens = await getFirstAvailableTokens();
        if (!tokens) {
          logger.warn('[DXT] No authentication tokens found. Authentication will be required.');
        } else {
          logger.info('[DXT] Found valid authentication tokens.');
        }
      } catch (error) {
        logger.error('[DXT] Error checking tokens:', error);
      }
      
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
