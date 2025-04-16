import { McpServer } from '@modelcontextprotocol/sdk';
import { z } from 'zod';
import { setupOAuthClient, searchPhotosByText } from '../api/photos.js';
import { getTokens } from '../auth/tokens.js';
import logger from '../utils/logger.js';

// Define the default user ID to use when no specific ID is provided
const DEFAULT_USER_ID = 'default_user';

/**
 * Register search-related tools with the MCP server
 */
export function registerSearchTools(server: McpServer): void {
  // Search photos by text query
  server.tool(
    'search_photos',
    {
      query: z.string().describe('Search query for photos (e.g., "vacation 2023", "sunset photos", "cats")'),
      pageSize: z.number().min(1).max(100).default(25).describe('Number of photos to return (1-100)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      includeLocation: z.boolean().default(true).describe('Include location data in results if available'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ query, pageSize, pageToken, includeLocation, userId }) => {
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
        
        // Search photos
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          query,
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
              query,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in search_photos: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error searching photos: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'Search for photos in Google Photos by text query',
      examples: [
        {
          name: 'Search for vacation photos',
          parameters: { query: 'vacation 2023', pageSize: 10 }
        },
        {
          name: 'Search for photos with animals',
          parameters: { query: 'animals', pageSize: 5 }
        }
      ]
    }
  );
}
