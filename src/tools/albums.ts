// Import using require
const sdk = require('@modelcontextprotocol/sdk');
import { z } from 'zod';
import { setupOAuthClient, listAlbums, getAlbum, listAlbumPhotos } from '../api/photos.js';
import { getTokens } from '../auth/tokens.js';
import logger from '../utils/logger.js';

// Define the default user ID to use when no specific ID is provided
const DEFAULT_USER_ID = 'default_user';

/**
 * Register album-related tools with the MCP server
 */
export function registerAlbumTools(server: any): void {
  // List all albums
  server.tool(
    'list_albums',
    {
      pageSize: z.number().min(1).max(50).default(20).describe('Number of albums to return (1-50)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ pageSize, pageToken, userId }) => {
      try {
        // Get the user ID to use
        const userIdToUse = userId || DEFAULT_USER_ID;
        
        // Get tokens for the user
        const tokens = await getTokens(userIdToUse);
        if (!tokens) {
          return {
            content: [{ 
              type: 'text', 
              text: 'Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth'
            }]
          };
        }
        
        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // List albums
        const { albums, nextPageToken } = await listAlbums(
          oauth2Client,
          pageSize,
          pageToken
        );
        
        // Format the result
        const albumItems = albums.map(album => ({
          id: album.id,
          title: album.title,
          url: album.productUrl,
          itemCount: album.mediaItemsCount || '0',
          coverPhotoUrl: album.coverPhotoBaseUrl || '',
        }));
        
        // Return the results
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify({
              count: albumItems.length,
              nextPageToken,
              albums: albumItems,
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in list_albums: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error listing albums: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'List albums in Google Photos',
      examples: [
        {
          name: 'List albums',
          parameters: { pageSize: 10 }
        }
      ]
    }
  );
  
  // Get a specific album
  server.tool(
    'get_album',
    {
      albumId: z.string().describe('ID of the album to retrieve'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ albumId, userId }) => {
      try {
        // Get the user ID to use
        const userIdToUse = userId || DEFAULT_USER_ID;
        
        // Get tokens for the user
        const tokens = await getTokens(userIdToUse);
        if (!tokens) {
          return {
            content: [{ 
              type: 'text', 
              text: 'Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth'
            }]
          };
        }
        
        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // Get album
        const album = await getAlbum(oauth2Client, albumId);
        
        // Format the result
        const albumData = {
          id: album.id,
          title: album.title,
          url: album.productUrl,
          itemCount: album.mediaItemsCount || '0',
          coverPhotoUrl: album.coverPhotoBaseUrl || '',
        };
        
        // Return the results
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(albumData, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in get_album: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error getting album: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'Get details of a specific album in Google Photos',
      examples: [
        {
          name: 'Get album details',
          parameters: { albumId: 'ABC123xyz' }
        }
      ]
    }
  );
  
  // List photos in an album
  server.tool(
    'list_album_photos',
    {
      albumId: z.string().describe('ID of the album to get photos from'),
      pageSize: z.number().min(1).max(100).default(25).describe('Number of photos to return (1-100)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      includeLocation: z.boolean().default(true).describe('Include location data if available'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ albumId, pageSize, pageToken, includeLocation, userId }) => {
      try {
        // Get the user ID to use
        const userIdToUse = userId || DEFAULT_USER_ID;
        
        // Get tokens for the user
        const tokens = await getTokens(userIdToUse);
        if (!tokens) {
          return {
            content: [{ 
              type: 'text', 
              text: 'Not authenticated with Google Photos. Please authenticate first by visiting http://localhost:3000/auth'
            }]
          };
        }
        
        // Set up OAuth client
        const oauth2Client = setupOAuthClient(tokens);
        
        // List album photos
        const { photos, nextPageToken } = await listAlbumPhotos(
          oauth2Client,
          albumId,
          pageSize,
          pageToken,
          includeLocation
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
            type: 'text', 
            text: JSON.stringify({
              albumId,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in list_album_photos: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error listing album photos: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'List photos in a specific album in Google Photos',
      examples: [
        {
          name: 'List photos in album',
          parameters: { albumId: 'ABC123xyz', pageSize: 10 }
        }
      ]
    }
  );
}
