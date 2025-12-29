import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { PhotoItem } from '../api/photos.js';
import { getFirstAvailableTokens, TokenData } from '../auth/tokens.js';
import {
  setupOAuthClient,
  searchPhotosByText,
  searchPhotosByLocation,
  listAlbums,
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
  getAlbum,
} from '../api/photos.js';
import logger from '../utils/logger.js';
import { validateArgs } from '../utils/validation.js';
import {
  searchPhotosSchema,
  searchPhotosByLocationSchema,
  getPhotoSchema,
  listAlbumsSchema,
  getAlbumSchema,
  listAlbumPhotosSchema,
} from '../schemas/toolSchemas.js';
import { quotaManager } from '../utils/quotaManager.js';

/**
 * Formatted photo interfaces for MCP responses
 */
export interface FormattedPhotoLocation {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  region?: string;
  approximate: boolean;
}

export interface FormattedPhoto {
  id: string;
  filename: string;
  description: string;
  dateCreated: string;
  url: string;
  webUrl: string;
  width: string;
  height: string;
  location?: FormattedPhotoLocation;
  base64Image?: string;
}

export interface FormattedAlbum {
  id: string;
  title: string;
  url: string;
  itemsCount: string;
  coverPhotoUrl?: string;
}

/**
 * Core MCP server implementation shared between HTTP and STDIO modes.
 * Contains tool definitions, handlers, and business logic.
 */
export class GooglePhotosMCPCore {
  protected server: Server;

  constructor(serverInfo: { name: string; version: string }) {
    this.server = new Server(serverInfo, {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    });

    this.registerHandlers();
  }

  /**
   * Registers MCP request handlers
   * Protected to allow subclasses to customize handler registration
   */
  protected registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallTool.bind(this));
  }

  /**
   * Returns tool definitions
   * Protected to allow subclasses to access
   */
  protected async handleListTools() {
    return {
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
          description: 'Search for photos using a text query',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for photos',
              },
              pageSize: {
                type: 'number',
                description: 'Number of results to return (default: 25, max: 100)',
                default: 25,
              },
              pageToken: {
                type: 'string',
                description: 'Token for the next page of results',
              },
              includeLocation: {
                type: 'boolean',
                description: 'Whether to include location data (default: true)',
                default: true,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'search_photos_by_location',
          description: 'Search for photos by location name',
          inputSchema: {
            type: 'object',
            properties: {
              locationName: {
                type: 'string',
                description: 'Location name to search for',
              },
              pageSize: {
                type: 'number',
                description: 'Number of results to return (default: 25)',
                default: 25,
              },
              pageToken: {
                type: 'string',
                description: 'Token for pagination',
              },
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
                description: 'ID of the photo',
              },
              includeBase64: {
                type: 'boolean',
                description: 'Whether to include base64 image data',
                default: false,
              },
              includeLocation: {
                type: 'boolean',
                description: 'Whether to include location data',
                default: true,
              },
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
              },
              pageToken: {
                type: 'string',
                description: 'Token for pagination',
              },
            },
          },
        },
        {
          name: 'get_album',
          description: 'Get details of a specific album',
          inputSchema: {
            type: 'object',
            properties: {
              albumId: {
                type: 'string',
                description: 'ID of the album',
              },
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
                description: 'ID of the album',
              },
              pageSize: {
                type: 'number',
                description: 'Number of results to return (default: 25)',
                default: 25,
              },
              pageToken: {
                type: 'string',
                description: 'Token for pagination',
              },
              includeLocation: {
                type: 'boolean',
                description: 'Whether to include location data',
                default: true,
              },
            },
            required: ['albumId'],
          },
        },
      ],
    };
  }

  /**
   * Handles tool execution requests
   */
  protected async handleCallTool(request: CallToolRequest) {
    logger.info(`Handling tool request: ${request.params.name}`);

    // Get authentication tokens
    const tokens = await getFirstAvailableTokens();

    if (!tokens && request.params.name !== 'auth_status') {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "Authentication required",
            message: "Not authenticated with Google Photos. Please authenticate first."
          })
        }]
      };
    }

    // Execute tool handler
    switch (request.params.name) {
      case 'auth_status':
        return this.handleAuthStatus(tokens);

      case 'search_photos':
        return this.handleSearchPhotos(request, tokens!);

      case 'search_photos_by_location':
        return this.handleSearchPhotosByLocation(request, tokens!);

      case 'list_albums':
        return this.handleListAlbums(request, tokens!);

      case 'get_photo':
        return this.handleGetPhoto(request, tokens!);

      case 'get_album':
        return this.handleGetAlbum(request, tokens!);

      case 'list_album_photos':
        return this.handleListAlbumPhotos(request, tokens!);

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  }

  /**
   * Tool Handlers
   */
  private handleAuthStatus(tokens: TokenData | null) {
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
  }

  private async handleSearchPhotos(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, searchPhotosSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = setupOAuthClient(tokens);
    const { photos, nextPageToken } = await searchPhotosByText(
      oauth2Client,
      args.query,
      args.pageSize || 25,
      args.pageToken,
      args.includeLocation !== false
    );

    quotaManager.recordRequest(false);

    const photoItems = photos.map(this.formatPhoto);

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

  private async handleSearchPhotosByLocation(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, searchPhotosByLocationSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = setupOAuthClient(tokens);
    const { photos, nextPageToken } = await searchPhotosByLocation(
      oauth2Client,
      args.locationName,
      args.pageSize || 25,
      args.pageToken
    );

    quotaManager.recordRequest(false);

    const photoItems = photos.map(this.formatPhoto);

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

  private async handleListAlbums(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, listAlbumsSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = setupOAuthClient(tokens);
    const { albums, nextPageToken } = await listAlbums(
      oauth2Client,
      args.pageSize || 20,
      args.pageToken
    );

    quotaManager.recordRequest(false);

    const albumItems = albums.map(album => ({
      id: album.id,
      title: album.title,
      url: album.productUrl,
      itemsCount: album.mediaItemsCount || '0',
      coverPhotoUrl: album.coverPhotoBaseUrl,
    }));

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

  private async handleGetPhoto(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, getPhotoSchema);
    quotaManager.checkQuota(args.includeBase64 || false);

    const oauth2Client = setupOAuthClient(tokens);
    const photo = await getPhoto(
      oauth2Client,
      args.photoId,
      args.includeLocation !== false
    );

    quotaManager.recordRequest(args.includeBase64 || false);

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

  private async handleGetAlbum(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, getAlbumSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = setupOAuthClient(tokens);
    const album = await getAlbum(oauth2Client, args.albumId);

    quotaManager.recordRequest(false);

    const result: FormattedAlbum = {
      id: album.id,
      title: album.title,
      url: album.productUrl,
      itemsCount: album.mediaItemsCount || '0',
      coverPhotoUrl: album.coverPhotoBaseUrl,
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async handleListAlbumPhotos(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, listAlbumPhotosSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = setupOAuthClient(tokens);
    const { photos, nextPageToken } = await listAlbumPhotos(
      oauth2Client,
      args.albumId,
      args.pageSize || 25,
      args.pageToken,
      args.includeLocation !== false
    );

    quotaManager.recordRequest(false);

    const photoItems = photos.map(this.formatPhoto);

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

  /**
   * Formats a photo for MCP response
   */
  protected formatPhoto(photo: PhotoItem): FormattedPhoto {
    const result: FormattedPhoto = {
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
        approximate: photo.locationData.approximate,
      };
    }

    return result;
  }

  /**
   * Gets the MCP server instance
   */
  getServer(): Server {
    return this.server;
  }
}
