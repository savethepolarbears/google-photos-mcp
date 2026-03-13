import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { PhotoItem } from '../api/photos.js';
import { getFirstAvailableTokens, TokenData } from '../auth/tokens.js';
import { tokenRefreshManager } from '../auth/tokenRefreshManager.js';
import {
  setupOAuthClient,
  searchPhotosByText,
  searchPhotosByLocation,
  listAlbums,
  listAlbumPhotos,
  listMediaItems,
  getPhoto,
  getPhotoAsBase64,
  getAlbum,
  createAlbum,
  uploadMedia,
  batchCreateMediaItems,
  batchAddMediaItemsToAlbum,
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
  createAlbumSchema,
  uploadMediaSchema,
  addMediaToAlbumSchema,
} from '../schemas/toolSchemas.js';
import { quotaManager } from '../utils/quotaManager.js';

/**
 * Formatted photo interfaces for MCP responses
 */
interface FormattedPhotoLocation {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  region?: string;
  approximate: boolean;
}

interface FormattedPhoto {
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

interface FormattedAlbum {
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
    this.server.setRequestHandler(ListResourcesRequestSchema, this.handleListResources.bind(this));
    this.server.setRequestHandler(ReadResourceRequestSchema, this.handleReadResource.bind(this));
  }

  protected async handleListResources() {
    return {
      resources: [
        {
          uri: 'google-photos://albums',
          name: 'Google Photos Albums',
          description: 'List of all Google Photos albums',
          mimeType: 'application/json',
        },
      ],
      resourceTemplates: [
        {
          uriTemplate: 'google-photos://albums/{albumId}',
          name: 'Google Photos Album',
          description: 'A specific Google Photos album by ID',
          mimeType: 'application/json',
        },
        {
          uriTemplate: 'google-photos://media/{mediaItemId}',
          name: 'Google Photos Media Item',
          description: 'A specific Google Photos media item by ID. Note: baseUrl is ephemeral (~60 min); always fetch fresh.',
          mimeType: 'application/json',
        },
      ],
    };
  }

  protected async handleReadResource(request: { params: { uri: string } }) {
    const uri = request.params.uri;
    const tokens = await getFirstAvailableTokens();
    if (!tokens) throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated');
    const oauth2Client = await this.getAuthenticatedClient(tokens);

    if (uri === 'google-photos://albums') {
      quotaManager.checkQuota(false);
      const data = await listAlbums(oauth2Client);
      quotaManager.recordRequest(false);
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      };
    }

    const albumMatch = uri.match(/^google-photos:\/\/albums\/(.+)$/);
    if (albumMatch) {
      quotaManager.checkQuota(false);
      const album = await getAlbum(oauth2Client, albumMatch[1]);
      quotaManager.recordRequest(false);
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(album, null, 2),
        }],
      };
    }

    const mediaMatch = uri.match(/^google-photos:\/\/media\/(.+)$/);
    if (mediaMatch) {
      quotaManager.checkQuota(false);
      const mediaItem = await getPhoto(oauth2Client, mediaMatch[1], false);
      quotaManager.recordRequest(false);
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify(mediaItem, null, 2),
        }],
      };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
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
          name: 'create_album',
          description: 'Create a new Google Photos album',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Title for the new album (required)',
              },
            },
            required: ['title'],
          },
        },
        {
          name: 'upload_media',
          description: 'Upload a local media file to Google Photos. Reads bytes from filePath and creates a new media item.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Absolute path to the local file to upload' },
              mimeType: { type: 'string', description: 'MIME type (e.g., image/jpeg, video/mp4)' },
              fileName: { type: 'string', description: 'File name to use in Google Photos' },
              albumId: { type: 'string', description: 'Optional: album ID to add the media to immediately' },
              description: { type: 'string', description: 'Optional: description/caption for the media item' },
            },
            required: ['filePath', 'mimeType', 'fileName'],
          },
        },
        {
          name: 'add_media_to_album',
          description: 'Add existing media items to a Google Photos album. Maximum 50 items per call.',
          inputSchema: {
            type: 'object',
            properties: {
              albumId: { type: 'string', description: 'ID of the album to add media to' },
              mediaItemIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of media item IDs to add (1-50 items)',
                minItems: 1,
                maxItems: 50,
              },
            },
            required: ['albumId', 'mediaItemIds'],
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
        {
          name: 'list_media_items',
          description: 'List all media items in the library (not filtered by album)',
          inputSchema: {
            type: 'object',
            properties: {
              pageSize: {
                type: 'number',
                description: 'Number of results to return (default: 25, max: 100)',
                default: 25,
              },
              pageToken: {
                type: 'string',
                description: 'Token for pagination',
              },
            },
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

    if (request.params.name === 'auth_status') {
      return await this.handleAuthStatus(tokens);
    }

    if (!tokens) {
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
    try {
      switch (request.params.name) {
        case 'search_photos':
          return await this.handleSearchPhotos(request, tokens);

        case 'search_photos_by_location':
          return await this.handleSearchPhotosByLocation(request, tokens);

        case 'list_albums':
          return await this.handleListAlbums(request, tokens);

        case 'get_photo':
          return await this.handleGetPhoto(request, tokens);

        case 'get_album':
          return await this.handleGetAlbum(request, tokens);

        case 'create_album':
          return await this.handleCreateAlbum(request, tokens);

        case 'upload_media':
          return await this.handleUploadMedia(request, tokens);

        case 'add_media_to_album':
          return await this.handleAddMediaToAlbum(request, tokens);

        case 'list_album_photos':
          return await this.handleListAlbumPhotos(request, tokens);

        case 'list_media_items':
          return await this.handleListMediaItems(request, tokens);

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      return {
        isError: true,
        content: [{
          type: "text",
          text: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }

  /**
   * Gets an authenticated OAuth2Client, refreshing tokens if necessary.
   * Uses tokenRefreshManager to prevent concurrent refreshes.
   */
  protected async getAuthenticatedClient(tokens: TokenData) {
    const oauth2Client = setupOAuthClient(tokens);
    const userId = tokens.userId || 'default';
    const freshTokens = await tokenRefreshManager.refreshIfNeeded(oauth2Client, userId, tokens);

    // If tokens were refreshed, update the client credentials
    if (freshTokens.access_token !== tokens.access_token) {
      oauth2Client.setCredentials({
        access_token: freshTokens.access_token,
        refresh_token: freshTokens.refresh_token,
        expiry_date: freshTokens.expiry_date,
      });
    }

    return oauth2Client;
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

  private async handleCreateAlbum(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, createAlbumSchema);
    quotaManager.checkQuota(false);
    
    try {
      const oauth2Client = await this.getAuthenticatedClient(tokens);
      const album = await createAlbum(oauth2Client, args.title);
      quotaManager.recordRequest(false);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ album }, null, 2),
        }],
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('PERMISSION_DENIED')) {
        errorMessage += "\n\nRe-authenticate at http://localhost:3000/auth to grant write permissions (appendonly scope required).";
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  private async handleUploadMedia(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, uploadMediaSchema);
    quotaManager.checkQuota(false);
    try {
      const oauth2Client = await this.getAuthenticatedClient(tokens);
      const result = await uploadMedia(oauth2Client, args.filePath, args.mimeType, args.fileName, args.albumId, args.description);
      quotaManager.recordRequest(false);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('PERMISSION_DENIED')) {
        errorMessage += "\n\nRe-authenticate at http://localhost:3000/auth to grant write permissions (appendonly scope required).";
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  private async handleAddMediaToAlbum(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, addMediaToAlbumSchema);
    quotaManager.checkQuota(false);
    try {
      const oauth2Client = await this.getAuthenticatedClient(tokens);
      await batchAddMediaItemsToAlbum(oauth2Client, args.albumId, args.mediaItemIds);
      quotaManager.recordRequest(false);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            albumId: args.albumId,
            addedCount: args.mediaItemIds.length,
          }, null, 2),
        }],
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('PERMISSION_DENIED')) {
        errorMessage += "\n\nRe-authenticate at http://localhost:3000/auth to grant write permissions (appendonly scope required).";
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  private async handleSearchPhotos(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, searchPhotosSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

    const oauth2Client = await this.getAuthenticatedClient(tokens);
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

  // listMediaItems uses listAlbumsSchema — same shape
  private async handleListMediaItems(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, listAlbumsSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = await this.getAuthenticatedClient(tokens);
    const { photos, nextPageToken } = await listMediaItems(
      oauth2Client,
      args.pageSize || 25,
      args.pageToken
    );

    quotaManager.recordRequest(false);

    const photoItems = photos.map(p => this.formatPhoto(p));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
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
