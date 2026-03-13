import { OAuth2Client } from 'google-auth-library';
import { Album } from '../types.js';
import { getPhotoClient } from '../client.js';
import { toError } from '../client.js';
import { withRetry } from '../../utils/retry.js';
import logger from '../../utils/logger.js';

/**
 * Album repository for CRUD operations
 */

/**
 * Lists all albums from the user's library.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param pageSize - The number of albums to retrieve per page. Default is 50.
 * @param pageToken - The token for the next page of results.
 * @returns A Promise resolving to an object containing the list of albums and an optional next page token.
 * @throws Error if listing albums fails.
 */
export async function listAlbums(
  oauth2Client: OAuth2Client,
  pageSize = 50,
  pageToken?: string,
): Promise<{ albums: Album[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () => await photosClient.albums.list({
        pageSize,
        pageToken,
      }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'list albums'
    );

    return {
      albums: response.data.albums ?? [],
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    const message = toError(error, 'list albums').message;
    logger.error(`Failed to list albums: ${message}`);
    throw new Error('Failed to list albums', { cause: error });
  }
}

/**
 * Gets a specific album by its ID.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param albumId - The ID of the album to retrieve.
 * @returns A Promise resolving to the Album object.
 * @throws Error if the album is not found or the request fails.
 */
export async function getAlbum(oauth2Client: OAuth2Client, albumId: string): Promise<Album> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () => await photosClient.albums.get({
        albumId,
      }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'get album'
    );

    if (!response.data) {
      throw new Error('Album not found');
    }

    return response.data as Album;
  } catch (error) {
    const message = toError(error, 'get album').message;
    logger.error(`Failed to get album: ${message}`);
    throw new Error('Failed to get album', { cause: error });
  }
}

/**
 * Creates a new album.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param title - The title of the new album.
 * @returns A Promise resolving to the created Album object.
 * @throws Error if creating the album fails.
 */
export async function createAlbum(oauth2Client: OAuth2Client, title: string): Promise<Album> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    const response = await withRetry(
      async () => await photosClient.albums.create({ title }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'create album'
    );

    return response.data as Album;
  } catch (error) {
    const message = toError(error, 'create album').message;
    logger.error(`Failed to create album: ${message}`);
    throw new Error('Failed to create album', { cause: error });
  }
}

/**
 * Adds existing media items to an album.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param albumId - The ID of the album to add media items to.
 * @param mediaItemIds - Array of media item IDs to add.
 * @throws Error if adding media items fails.
 */
export async function batchAddMediaItemsToAlbum(
  oauth2Client: OAuth2Client,
  albumId: string,
  mediaItemIds: string[]
): Promise<void> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    await withRetry(
      async () => await photosClient.albums.batchAddMediaItems({ albumId, mediaItemIds }),
      { maxRetries: 3, initialDelayMs: 1000 },
      'batch add media items to album'
    );
  } catch (error) {
    const message = toError(error, 'batch add media items to album').message;
    logger.error(`Failed to add media to album: ${message}`);
    throw new Error('Failed to add media to album', { cause: error });
  }
}
