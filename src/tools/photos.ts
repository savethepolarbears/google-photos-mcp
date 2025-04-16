import { McpServer } from '@modelcontextprotocol/sdk';
import { z } from 'zod';
import { setupOAuthClient, getPhoto, getPhotoAsBase64 } from '../api/photos';
import { getTokens } from '../auth/tokens';
import logger from '../utils/logger';

// Define the default user ID to use when no specific ID is provided
const DEFAULT_USER_ID = 'default_user';

/**
 * Register photo-related tools with the MCP server
 */
export function registerPhotoTools(server: McpServer): void {
  // Get a specific photo by ID
  server.tool(
    'get_photo',
    {
      photoId: z.string().describe('ID of the photo to retrieve'),
      includeBase64: z.boolean().default(false).describe('Whether to include the photo as base64 data'),
      includeLocation: z.boolean().default(true).describe('Include location data if available'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ photoId, includeBase64, includeLocation, userId }) => {
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
        
        // Get photo with location if requested
        const photo = await getPhoto(oauth2Client, photoId, includeLocation);
        
        // Format the result
        const photoData: any = {
          id: photo.id,
          filename: photo.filename,
          description: photo.description || '',
          mimeType: photo.mimeType,
          dateCreated: photo.mediaMetadata?.creationTime || '',
          url: photo.baseUrl,
          webUrl: photo.productUrl,
          width: photo.mediaMetadata?.width || '',
          height: photo.mediaMetadata?.height || '',
        };
        
        // Add camera info if available
        if (photo.mediaMetadata?.photo) {
          photoData.camera = {
            make: photo.mediaMetadata.photo.cameraMake || '',
            model: photo.mediaMetadata.photo.cameraModel || '',
            focalLength: photo.mediaMetadata.photo.focalLength || '',
            aperture: photo.mediaMetadata.photo.apertureFNumber || '',
            iso: photo.mediaMetadata.photo.isoEquivalent || '',
          };
        }
        
        // Include location data if available
        if (photo.locationData) {
          photoData.location = {
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
        
        // Include base64 data if requested
        if (includeBase64) {
          try {
            photoData.base64Data = await getPhotoAsBase64(photo.baseUrl);
          } catch (error) {
            logger.error(`Failed to get base64 data: ${error instanceof Error ? error.message : String(error)}`);
            photoData.base64Error = 'Failed to get base64 data';
          }
        }
        
        // Return the results
        return {
          content: [{ 
            type: 'text', 
            text: JSON.stringify(photoData, null, 2)
          }]
        };
      } catch (error) {
        logger.error(`Error in get_photo: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error getting photo: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'Get details of a specific photo in Google Photos',
      examples: [
        {
          name: 'Get photo details',
          parameters: { photoId: 'ABC123xyz' }
        },
        {
          name: 'Get photo with base64 data',
          parameters: { photoId: 'ABC123xyz', includeBase64: true }
        }
      ]
    }
  );
  
  // Get a photo as an image (returns URL)
  server.tool(
    'get_photo_url',
    {
      photoId: z.string().describe('ID of the photo to retrieve'),
      size: z.enum(['s', 'm', 'l', 'd']).default('m').describe('Photo size: s=small, m=medium, l=large, d=original'),
      userId: z.string().optional().describe('User ID (leave empty to use default user)'),
    },
    async ({ photoId, size, userId }) => {
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
        
        // Get photo
        const photo = await getPhoto(oauth2Client, photoId);
        
        // Construct URL with size parameter
        // https://developers.google.com/photos/library/guides/access-media-items#base-urls
        const photoUrl = `${photo.baseUrl}=${size}`;
        
        // Return the URL
        return {
          content: [{ 
            type: 'text', 
            text: photoUrl
          }]
        };
      } catch (error) {
        logger.error(`Error in get_photo_url: ${error instanceof Error ? error.message : String(error)}`);
        
        return {
          content: [{ 
            type: 'text', 
            text: `Error getting photo URL: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    },
    {
      description: 'Get the URL of a specific photo in Google Photos',
      examples: [
        {
          name: 'Get medium size photo URL',
          parameters: { photoId: 'ABC123xyz', size: 'm' }
        },
        {
          name: 'Get original size photo URL',
          parameters: { photoId: 'ABC123xyz', size: 'd' }
        }
      ]
    }
  );
}
