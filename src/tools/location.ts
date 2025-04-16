import { McpServer } from '@modelcontextprotocol/sdk';
import { z } from 'zod';
import { setupOAuthClient, searchPhotosByText } from '../api/photos';
import { getTokens } from '../auth/tokens';
import { searchLocationByName } from '../utils/location';
import logger from '../utils/logger';

// Define the default user ID to use when no specific ID is provided
const DEFAULT_USER_ID = 'default_user';

/**
 * Register location-related tools with the MCP server
 */
export function registerLocationTools(server: McpServer): void {
  // Search photos by location
  server.tool(
    'search_photos_by_location',
    {
      locationName: z.string().describe('Location name to search for (e.g., "Paris", "Central Park", "Mount Everest")'),
      pageSize: z.number().min(1).max(100).default(25).describe('Number of photos to return (1-100)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ locationName, pageSize, pageToken, userId }) => {
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
        
        // Try to get coordinates for the location name
        const locationData = await searchLocationByName(locationName);
        
        // Create a search query combining the location name with variations
        let searchQuery = locationName;
        
        // Add additional location information to the search query if available
        if (locationData) {
          const locationTerms = [
            locationData.locationName,
            locationData.city,
            locationData.region,
            locationData.countryName
          ].filter(Boolean);
          
          // Add unique terms to the search query
          for (const term of locationTerms) {
            if (term && !searchQuery.toLowerCase().includes(term.toLowerCase())) {
              searchQuery += ` ${term}`;
            }
          }
        }
        
        // Search photos
        const { photos, nextPageToken } = await searchPhotosByText(
          oauth2Client,
          searchQuery,
          pageSize,
          pageToken,
          true // Include location data
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
              location: locationName,
              count: photoItems.length,
              nextPageToken,
              photos: photoItems,
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in search_photos_by_location: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error searching photos by location: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'Search for photos taken at a specific location in Google Photos',
      examples: [
        {
          name: 'Search for photos from Paris',
          parameters: { locationName: 'Paris, France', pageSize: 10 }
        },
        {
          name: 'Search for photos from a national park',
          parameters: { locationName: 'Yellowstone National Park', pageSize: 5 }
        }
      ]
    }
  );
}
