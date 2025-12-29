import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import { PhotoItem, SearchParams } from '../types.js';
import { getPhotoClient, toError } from '../client.js';
import { enrichPhotosWithLocation } from '../enrichment/locationEnricher.js';
import { getPhotoLocation } from '../../utils/location.js';
import { withRetry } from '../../utils/retry.js';
import logger from '../../utils/logger.js';

/**
 * Photo repository for CRUD operations
 */

/**
 * Searches for photos using the Google Photos API search endpoint.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param params - The search parameters (filters, albumId, etc.).
 * @param includeLocation - Whether to enrich photos with location data. Default is false.
 * @returns A Promise resolving to a list of photos and an optional next page token.
 * @throws Error if the search fails.
 */
export async function searchPhotos(
  oauth2Client: OAuth2Client,
  params: SearchParams,
  includeLocation: boolean = false,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () => await photosClient.mediaItems.search({
        requestBody: {
          albumId: params.albumId,
          pageSize: params.pageSize ?? 25,
          pageToken: params.pageToken,
          filters: params.filters,
        },
      }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'search photos'
    );

    const photos = (response.data.mediaItems ?? []) as PhotoItem[];
    await enrichPhotosWithLocation(photos, includeLocation, false);

    return {
      photos,
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    const message = toError(error, 'search photos').message;
    logger.error(`Failed to search photos: ${message}`);
    throw new Error('Failed to search photos');
  }
}

/**
 * Lists photos from a specific album.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param albumId - The ID of the album.
 * @param pageSize - The number of photos to retrieve per page. Default is 25.
 * @param pageToken - The token for the next page of results.
 * @param includeLocation - Whether to include location data. Default is false.
 * @returns A Promise resolving to a list of photos and an optional next page token.
 * @throws Error if listing album photos fails.
 */
export async function listAlbumPhotos(
  oauth2Client: OAuth2Client,
  albumId: string,
  pageSize = 25,
  pageToken?: string,
  includeLocation: boolean = false,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    return await searchPhotos(
      oauth2Client,
      {
        albumId,
        pageSize,
        pageToken,
      },
      includeLocation,
    );
  } catch (error) {
    const message = toError(error, 'list album photos').message;
    logger.error(`Failed to list album photos: ${message}`);
    throw new Error('Failed to list album photos');
  }
}

/**
 * Gets a specific photo by its ID.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param photoId - The ID of the photo to retrieve.
 * @param includeLocation - Whether to include location data. Default is true.
 * @returns A Promise resolving to the PhotoItem object.
 * @throws Error if the photo is not found or request fails.
 */
export async function getPhoto(
  oauth2Client: OAuth2Client,
  photoId: string,
  includeLocation: boolean = true,
): Promise<PhotoItem> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () => await photosClient.mediaItems.get({
        mediaItemId: photoId,
      }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'get photo'
    );

    if (!response.data) {
      throw new Error('Photo not found');
    }

    const photo = response.data as PhotoItem;

    if (includeLocation) {
      try {
        const locationData = await getPhotoLocation(photo, true);
        if (locationData) {
          photo.locationData = locationData;
        }
      } catch (error) {
        logger.warn(
          `Could not get location data for photo ${photoId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return photo;
  } catch (error) {
    const message = toError(error, 'get photo').message;
    logger.error(`Failed to get photo: ${message}`);
    throw new Error('Failed to get photo');
  }
}

/**
 * Downloads a photo and returns it as a Base64 string.
 *
 * @param url - The URL of the photo (usually the baseUrl from a PhotoItem).
 * @returns A Promise resolving to the Base64 encoded string of the image.
 * @throws Error if the download fails.
 */
export async function getPhotoAsBase64(url: string): Promise<string> {
  if (!url) {
    throw new Error('Invalid photo URL');
  }

  try {
    const fullResUrl = `${url}=d`;
    const response = await axios.get<ArrayBuffer>(fullResUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    return buffer.toString('base64');
  } catch (error) {
    logger.error(`Failed to download photo: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to download photo');
  }
}
