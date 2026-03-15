import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import http from 'http';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { PhotoItem } from '../api/photos.js';
import { getFirstAvailableTokens, TokenData } from '../auth/tokens.js';
import { tokenRefreshManager } from '../auth/tokenRefreshManager.js';
import {
  createOAuthClient,
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
  batchAddMediaItemsToAlbum,
  addEnrichment,
  patchAlbum,
  createPickerSession,
  getPickerSession,
  listPickerSessionMediaItems,
} from '../api/photos.js';
import { searchPhotos } from '../api/repositories/photosRepository.js';
import type { SearchFilter } from '../api/types.js';
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
  searchMediaByFilterSchema,
  addEnrichmentSchema,
  setCoverPhotoSchema,
  createAlbumWithMediaSchema,
  contentCategoryEnum,
  pollPickerSessionSchema,
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
  /** Track the running auth server so repeated start_auth calls clean up properly */
  private _authServer: http.Server | null = null;
  private _authTimeout: ReturnType<typeof setTimeout> | null = null;

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
    this.server.setRequestHandler(ListPromptsRequestSchema, this.handleListPrompts.bind(this));
    this.server.setRequestHandler(GetPromptRequestSchema, this.handleGetPrompt.bind(this));
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
        {
          name: 'search_media_by_filter',
          description: 'Search media items using structured filters (dates, categories, media type, features). Use this for deterministic filter-based retrieval instead of text queries.',
          inputSchema: {
            type: 'object',
            properties: {
              dates: { type: 'array', description: 'Specific dates to filter by (max 5)' },
              dateRanges: { type: 'array', description: 'Date ranges to filter by (max 5)' },
              includedCategories: { type: 'array', description: 'Content categories to include' },
              excludedCategories: { type: 'array', description: 'Content categories to exclude' },
              mediaType: { type: 'string', enum: ['ALL_MEDIA', 'PHOTO', 'VIDEO'], description: 'Media type filter' },
              includeFavorites: { type: 'boolean', description: 'Include only favorites' },
              includeArchived: { type: 'boolean', description: 'Include archived items' },
              orderBy: { type: 'string', description: 'Order results (requires dateFilter)' },
              pageSize: { type: 'number', description: 'Number of results (max 100)' },
              pageToken: { type: 'string', description: 'Token for pagination' },
            },
          },
        },

        {
          name: 'add_album_enrichment',
          description: 'Add a text or location enrichment to a Google Photos album.',
          inputSchema: {
            type: 'object',
            properties: {
              albumId: { type: 'string', description: 'ID of the album' },
              type: { type: 'string', enum: ['TEXT', 'LOCATION'], description: 'Enrichment type' },
              text: { type: 'string', description: 'Text content (required when type is TEXT)' },
              locationName: { type: 'string', description: 'Location name (required when type is LOCATION)' },
              latitude: { type: 'number', description: 'Latitude for location enrichment' },
              longitude: { type: 'number', description: 'Longitude for location enrichment' },
              position: { type: 'string', enum: ['FIRST_IN_ALBUM', 'LAST_IN_ALBUM'], description: 'Position in album' },
            },
            required: ['albumId', 'type'],
          },
        },
        {
          name: 'set_album_cover',
          description: 'Set the cover photo of a Google Photos album.',
          inputSchema: {
            type: 'object',
            properties: {
              albumId: { type: 'string', description: 'ID of the album' },
              mediaItemId: { type: 'string', description: 'ID of the media item to use as cover' },
            },
            required: ['albumId', 'mediaItemId'],
          },
        },
        {
          name: 'create_album_with_media',
          description: 'Create a new album and upload multiple local files to it in one step. Handles partial failures — returns per-file results. Max 50 files per call. Note: albums cannot be deleted via the API, so an empty album persists if all uploads fail.',
          inputSchema: {
            type: 'object',
            properties: {
              albumTitle: { type: 'string', description: 'Title for the new album (1-500 chars)' },
              files: {
                type: 'array',
                description: 'Files to upload (1-50 items)',
                items: {
                  type: 'object',
                  properties: {
                    filePath: { type: 'string', description: 'Absolute path to the local file' },
                    mimeType: { type: 'string', description: 'MIME type (e.g., image/jpeg)' },
                    fileName: { type: 'string', description: 'File name to use in Google Photos' },
                    description: { type: 'string', description: 'Optional caption for the media item' },
                  },
                  required: ['filePath', 'mimeType', 'fileName'],
                },
                minItems: 1,
                maxItems: 50,
              },
            },
            required: ['albumTitle', 'files'],
          },
        },
        {
          name: 'describe_filter_capabilities',
          description: 'Returns a machine-readable JSON reference of all valid Google Photos search filter options, constraints, and examples. No arguments needed. Use this before constructing search_media_by_filter queries.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'create_picker_session',
          description: 'Create a Google Photos Picker session. Returns a pickerUri the user must open in their browser to select photos from their FULL library (not just app-created data). After the user selects photos, use poll_picker_session to retrieve them.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'poll_picker_session',
          description: 'Poll a Picker session to check if the user has finished selecting photos. If selection is complete (mediaItemsSet=true), returns the selected media items. Call repeatedly until mediaItemsSet is true.',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'The Picker session ID from create_picker_session' },
              pageSize: { type: 'number', description: 'Number of results per page (max 100)', default: 25 },
              pageToken: { type: 'string', description: 'Token for pagination' },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'start_auth',
          description: 'Start Google OAuth authentication flow. Spins up a temporary local server, returns a URL to visit in your browser. After you authenticate, tokens are saved automatically and the temp server shuts down.',
          inputSchema: {
            type: 'object',
            properties: {},
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
      return this.handleAuthStatus(tokens);
    }

    if (request.params.name === 'start_auth') {
      return await this.handleStartAuth();
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

        case 'search_media_by_filter':
          return await this.handleSearchMediaByFilter(request, tokens);


        case 'add_album_enrichment':
          return await this.handleAddAlbumEnrichment(request, tokens);

        case 'set_album_cover':
          return await this.handleSetAlbumCover(request, tokens);

        case 'create_album_with_media':
          return await this.handleCreateAlbumWithMedia(request, tokens);

        case 'describe_filter_capabilities':
          return this.handleDescribeFilterCapabilities();

        case 'create_picker_session':
          return await this.handleCreatePickerSession(tokens);

        case 'poll_picker_session':
          return await this.handlePollPickerSession(request, tokens);

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
            : "Not authenticated. Use the start_auth tool to begin authentication."
        })
      }]
    };
  }

  private enrichPermissionError(error: unknown): never {
    let msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('PERMISSION_DENIED')) {
      msg += '\n\nUse the start_auth tool to re-authenticate and grant write permissions (appendonly scope required).';
    }
    throw new Error(msg, { cause: error });
  }

  /**
   * Starts a temporary local HTTP server for Google OAuth authentication.
   * Returns the auth URL immediately. The server runs in the background
   * and auto-shuts down after successful auth or a 5-minute timeout.
   * After authenticating, call auth_status to verify.
   */
  private async handleStartAuth() {
    const config = (await import('../utils/config.js')).default;

    // Parse the configured redirect URI to extract port and path
    // This must match what's registered in Google Cloud Console
    const configuredRedirectUri = config.google.redirectUri;
    const parsedUri = new URL(configuredRedirectUri);
    const port = parseInt(parsedUri.port, 10) || 3000;
    const redirectUri = configuredRedirectUri;

    const { randomBytes } = await import('crypto');
    const { saveTokens } = await import('../auth/tokens.js');
    const { parseIdToken, resolveUserIdentity } = await import('../utils/googleUser.js');
    const express = (await import('express')).default;

    const app = express();
    const authStates = new Map<string, { expires: number }>();

    // Auth start route — redirects browser to Google consent screen
    app.get('/auth', (_req: import('express').Request, res: import('express').Response) => {
      try {
        const oauth2Client = createOAuthClient();
        const state = randomBytes(20).toString('hex');
        authStates.set(state, { expires: Date.now() + 10 * 60 * 1000 });

        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: config.google.scopes,
          state,
          prompt: 'consent',
          redirect_uri: redirectUri,
        });
        res.redirect(authUrl);
      } catch (error) {
        logger.error(`Auth error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).send('Authentication error');
      }
    });

    // Callback route — exchanges code for tokens, saves them, shuts down
    app.get('/auth/callback', async (req: import('express').Request, res: import('express').Response) => {
      try {
        const { code, state } = req.query;

        if (!state || !authStates.has(state as string)) {
          res.status(400).send('Invalid state parameter');
          return;
        }
        authStates.delete(state as string);

        if (!code) {
          res.status(400).send('No authorization code received');
          return;
        }

        const oauth2Client = createOAuthClient();
        const { tokens } = await oauth2Client.getToken({
          code: code as string,
          redirect_uri: redirectUri,
        });

        if (!tokens.access_token || !tokens.refresh_token) {
          res.status(500).send('Failed to get required tokens');
          return;
        }

        const verifiedPayload = await parseIdToken(tokens.id_token, oauth2Client);
        const identity = resolveUserIdentity(verifiedPayload);

        await saveTokens(identity.userId, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date || 0,
          userEmail: identity.email,
          userId: identity.userId,
          retrievedAt: Date.now(),
        });

        logger.info(`Authentication successful for user ID: ${identity.userId}${identity.email ? ` (${identity.email})` : ''}`);

        res.send(`
          <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: sans-serif; max-width: 500px; margin: 40px auto; text-align: center;">
              <h1>✅ Authentication Successful</h1>
              <p>You can close this tab. The MCP server is now authenticated with Google Photos.</p>
            </body>
          </html>
        `);

        // Auto-shutdown after response
        setTimeout(() => httpServer?.close(), 1000);
      } catch (error) {
        logger.error(`Callback error: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).send('Authentication callback error');
      }
    });

    // Shut down any previously running auth server (same-process)
    if (this._authServer) {
      try {
        this._authServer.close();
        logger.info('Shut down previous auth server');
      } catch { /* ignore */ }
      this._authServer = null;
    }
    if (this._authTimeout) {
      clearTimeout(this._authTimeout);
      this._authTimeout = null;
    }

    // Kill any orphaned process on the port (cross-process cleanup)
    // This handles the case where the MCP server restarted but the old
    // auth server process survived as an orphan.
    try {
      const { execSync } = await import('child_process');
      const pids = execSync(`lsof -i :${port} -P -n -t 2>/dev/null`, { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      if (pids.length > 0) {
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), 'SIGTERM');
          } catch { /* process may have already exited */ }
        }
        // Brief wait for port to be released
        await new Promise(resolve => setTimeout(resolve, 500));
        logger.info(`Killed ${pids.length} orphaned process(es) on port ${port}`);
      }
    } catch {
      // lsof not available or no process found — proceed normally
    }

    // Start the server and wait for it to be ready (catches EADDRINUSE)
    const httpServer = await new Promise<http.Server>((resolve, reject) => {
      const server: http.Server = app.listen(port, () => {
        logger.info(`Temporary auth server started on port ${port}`);
        resolve(server);
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Please close any other servers on port ${port} and try again.`));
        } else {
          reject(err);
        }
      });
    });

    this._authServer = httpServer;

    // Auto-shutdown after 5 minutes if no callback received
    this._authTimeout = setTimeout(() => {
      logger.warn('Auth server timed out after 5 minutes, shutting down');
      httpServer.close();
      this._authServer = null;
      this._authTimeout = null;
    }, 5 * 60 * 1000);
    this._authTimeout.unref(); // Don't keep process alive just for this timer

    httpServer.on('close', () => {
      if (this._authTimeout) clearTimeout(this._authTimeout);
      this._authServer = null;
      this._authTimeout = null;
      logger.info('Temporary auth server shut down');
    });

    const authUrl = `http://localhost:${port}/auth`;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: 'Authentication server started. Open the URL below in your browser to authenticate with Google Photos.',
          authUrl,
          instructions: [
            `1. Open this URL in your browser: ${authUrl}`,
            '2. Sign in with your Google account and grant permissions',
            '3. After success, close the browser tab',
            '4. Call auth_status to verify authentication',
          ],
          note: 'The temporary server will auto-shutdown after 5 minutes or after successful authentication.',
        }, null, 2),
      }],
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
      this.enrichPermissionError(error);
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
      this.enrichPermissionError(error);
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
      this.enrichPermissionError(error);
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

  private async handleSearchMediaByFilter(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, searchMediaByFilterSchema);
    quotaManager.checkQuota(false);

    const oauth2Client = await this.getAuthenticatedClient(tokens);

    const filters: SearchFilter = {};

    if (args.dates) {
      filters.dateFilter = { dates: args.dates };
    } else if (args.dateRanges) {
      filters.dateFilter = { ranges: args.dateRanges };
    }

    if (args.includedCategories || args.excludedCategories) {
      filters.contentFilter = {
        includedContentCategories: args.includedCategories,
        excludedContentCategories: args.excludedCategories,
      };
    }

    if (args.mediaType) {
      filters.mediaTypeFilter = { mediaTypes: [args.mediaType] };
    }

    // Feature filter — only FAVORITES goes into featureFilter
    if (args.includeFavorites) {
      filters.featureFilter = { includedFeatures: ['FAVORITES'] };
    }

    // includeArchivedMedia is a root-level boolean per Google API spec, NOT a feature
    if (args.includeArchived) {
      filters.includeArchivedMedia = true;
    }

    const { photos, nextPageToken } = await searchPhotos(
      oauth2Client,
      {
        filters,
        pageSize: args.pageSize,
        pageToken: args.pageToken,
        orderBy: args.orderBy,
      },
    );

    quotaManager.recordRequest(false);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: photos.length,
          nextPageToken,
          photos: photos.map(this.formatPhoto),
        }, null, 2),
      }],
    };
  }

  private async handleAddAlbumEnrichment(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, addEnrichmentSchema);
    quotaManager.checkQuota(false);

    try {
      const oauth2Client = await this.getAuthenticatedClient(tokens);
      const result = await addEnrichment(
        oauth2Client,
        args.albumId,
        {
          type: args.type,
          text: args.text,
          locationName: args.locationName,
          latitude: args.latitude,
          longitude: args.longitude,
        },
        args.position,
      );
      quotaManager.recordRequest(false);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('PERMISSION_DENIED')) {
        errorMessage += '\n\nUse the start_auth tool to re-authenticate and grant write permissions (appendonly scope required).';
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  private async handleCreateAlbumWithMedia(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, createAlbumWithMediaSchema);
    const oauth2Client = await this.getAuthenticatedClient(tokens);

    // Create the album first
    quotaManager.checkQuota(false);
    const album = await createAlbum(oauth2Client, args.albumTitle);
    quotaManager.recordRequest(false);

    // Upload each file directly to the album (pass album.id), collecting per-file results
    const uploadResults: Array<{ fileName: string; success: boolean; mediaItemId?: string; error?: string }> = [];
    for (const file of args.files) {
      try {
        quotaManager.checkQuota(false);
        // Pass album.id so Google adds the item to the album upon creation
        const media = await uploadMedia(oauth2Client, file.filePath, file.mimeType, file.fileName, album.id, file.description);
        quotaManager.recordRequest(false);
        // uploadMedia returns { mediaItemId, uploadToken } — use the correct property
        uploadResults.push({ fileName: file.fileName, success: true, mediaItemId: (media as { mediaItemId?: string }).mediaItemId });
      } catch (err) {
        uploadResults.push({ fileName: file.fileName, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // No need for batchAddMediaItemsToAlbum — album.id was passed to uploadMedia
    const addedCount = uploadResults.filter(r => r.success && r.mediaItemId).length;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ album, uploadResults, addedToAlbum: addedCount }, null, 2),
      }],
    };
  }

  protected async handleListPrompts() {
    return {
      prompts: [
        {
          name: 'organize_photos',
          description: 'Guides you through organizing photos into albums by theme or date range.',
          arguments: [
            { name: 'theme', description: 'Theme or subject (e.g., "vacation", "family")', required: false },
            { name: 'dateRange', description: 'Date range (e.g., "2023", "summer 2022")', required: false },
          ],
        },
        {
          name: 'batch_upload_workflow',
          description: 'Step-by-step workflow for uploading multiple local files to a Google Photos album.',
          arguments: [
            { name: 'albumName', description: 'Target album name (new or existing)', required: false },
          ],
        },
        {
          name: 'find_photos_by_criteria',
          description: 'Constructs a valid Google Photos filter query from a plain-language description.',
          arguments: [
            { name: 'criteria', description: 'What you want to find (e.g., "pet photos from last year")', required: true },
          ],
        },
      ],
    };
  }

  protected async handleGetPrompt(request: { params: { name: string; arguments?: Record<string, string> } }) {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'organize_photos':
        return {
          description: 'Workflow for organizing Google Photos into albums.',
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are organizing Google Photos${args.theme ? ` with theme: "${args.theme}"` : ''}${args.dateRange ? ` for date range: "${args.dateRange}"` : ''}.
Steps:
1. Use list_albums to see existing albums.
2. Use search_media_by_filter or search_photos to find relevant photos.
3. If needed, use create_album to create a new album.
4. Use add_media_to_album to add photos. Maximum 50 items per call — paginate if more.
5. Optionally use set_album_cover to set a representative cover photo.`,
            },
          }],
        };
      case 'batch_upload_workflow':
        return {
          description: 'Step-by-step batch upload workflow.',
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You are uploading multiple files to Google Photos${args.albumName ? ` into album: "${args.albumName}"` : ''}.
Preferred approach (single tool call):
- Use create_album_with_media if you have a file list and album title. Max 50 files per call.

Manual approach:
1. Use create_album to create the album (if it doesn't exist).
2. For each file, use upload_media with filePath, mimeType, fileName.
3. Collect returned mediaItemIds.
4. Use add_media_to_album with all collected IDs (max 50 per call).

Error handling: If an upload fails, continue with remaining files and report partial results.`,
            },
          }],
        };
      case 'find_photos_by_criteria':
        return {
          description: 'Guide for constructing valid Google Photos filter queries.',
          messages: [{
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `You need to find photos matching: "${args.criteria ?? 'criteria not specified'}".

Use describe_filter_capabilities to see all valid filter options, then use search_media_by_filter.

Key rules:
- albumId and filters are MUTUALLY EXCLUSIVE — do not use both.
- dateFilter.dates (max 5) and dateFilter.dateRanges (max 5) are mutually exclusive — pick one.
- orderBy requires a dateFilter to be present.
- For plain-text search, use search_photos instead of filter-based search.`,
            },
          }],
        };
      default:
        throw new McpError(ErrorCode.InvalidParams, `Prompt not found: ${request.params.name}`);
    }
  }

  private handleDescribeFilterCapabilities() {
    const capabilities = {
      mutuallyExclusive: [['albumId', 'filters'], ['dates', 'dateRanges']],
      dateFilter: {
        description: 'Filter by specific dates or date ranges (mutually exclusive)',
        maxDates: 5,
        maxRanges: 5,
        dateFields: { year: 'required (2000-2100)', month: 'optional (1-12)', day: 'optional (1-31)' },
      },
      contentCategories: contentCategoryEnum.options,
      mediaTypes: ['ALL_MEDIA', 'PHOTO', 'VIDEO'],
      featureFilters: {
        includeFavorites: 'boolean — include only items marked as favorites',
        includeArchived: 'boolean — include archived items',
      },
      orderBy: {
        values: ['MediaMetadata.creation_time', 'MediaMetadata.creation_time desc'],
        constraint: 'requires dateFilter (dates or dateRanges) to be set',
      },
      examples: [
        {
          description: 'All landscape photos from June 2023',
          args: { dates: [{ year: 2023, month: 6 }], includedCategories: ['LANDSCAPES'], mediaType: 'PHOTO' },
        },
        {
          description: 'Videos from 2022 ordered by newest first',
          args: { dateRanges: [{ startDate: { year: 2022, month: 1, day: 1 }, endDate: { year: 2022, month: 12, day: 31 } }], mediaType: 'VIDEO', orderBy: 'MediaMetadata.creation_time desc' },
        },
      ],
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(capabilities, null, 2) }],
    };
  }

  private async handleSetAlbumCover(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, setCoverPhotoSchema);
    quotaManager.checkQuota(false);

    try {
      const oauth2Client = await this.getAuthenticatedClient(tokens);
      const result = await patchAlbum(oauth2Client, args.albumId, { coverPhotoMediaItemId: args.mediaItemId });
      quotaManager.recordRequest(false);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('PERMISSION_DENIED')) {
        errorMessage += '\n\nRe-authenticate at http://localhost:3000/auth to grant write permissions (appendonly scope required).';
      }
      throw new Error(errorMessage, { cause: error });
    }
  }

  /**
   * Creates a new Picker session so the user can select photos from their full library.
   */
  private async handleCreatePickerSession(tokens: TokenData) {
    quotaManager.checkQuota(false);
    const oauth2Client = await this.getAuthenticatedClient(tokens);
    const session = await createPickerSession(oauth2Client);
    quotaManager.recordRequest(false);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId: session.id,
          pickerUri: session.pickerUri,
          instructions: [
            '1. Open the pickerUri in a browser to select photos from your library.',
            '2. After selecting, call poll_picker_session with the sessionId to check completion.',
            '3. Once mediaItemsSet is true, poll_picker_session returns the selected items.',
          ],
        }, null, 2),
      }],
    };
  }

  /**
   * Polls a Picker session, returning status or selected media items once ready.
   */
  private async handlePollPickerSession(request: CallToolRequest, tokens: TokenData) {
    const args = validateArgs(request.params.arguments, pollPickerSessionSchema);
    quotaManager.checkQuota(false);
    const oauth2Client = await this.getAuthenticatedClient(tokens);
    const session = await getPickerSession(oauth2Client, args.sessionId);
    quotaManager.recordRequest(false);

    if (!session.mediaItemsSet) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            sessionId: session.id,
            pickerUri: session.pickerUri,
            mediaItemsSet: false,
            message: 'User has not finished selecting photos yet. Call again after the user completes selection.',
          }, null, 2),
        }],
      };
    }

    // Selection complete — fetch items
    quotaManager.checkQuota(false);
    const { photos, nextPageToken } = await listPickerSessionMediaItems(
      oauth2Client,
      args.sessionId,
      args.pageSize ?? 25,
      args.pageToken,
    );
    quotaManager.recordRequest(false);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId: session.id,
          mediaItemsSet: true,
          count: photos.length,
          nextPageToken,
          photos: photos.map(this.formatPhoto),
        }, null, 2),
      }],
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
