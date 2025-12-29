import { OAuth2Client } from 'google-auth-library';
import { PhotoItem } from '../types.js';
import { searchPhotos } from '../repositories/photosRepository.js';
import { buildSearchTokens, filterPhotosByTokens, matchesLocationQuery } from '../search/tokenMatcher.js';
import { buildFiltersFromQuery } from '../search/filterBuilder.js';
import { toError } from '../client.js';
import logger from '../../utils/logger.js';

/**
 * High-level photo search service with orchestration logic
 */

/**
 * Searches for photos using a natural language text query.
 * Combines Google Photos API filters with client-side post-processing.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param query - The search query (e.g., "cats in Paris 2023").
 * @param pageSize - The number of results to return. Default is 25.
 * @param pageToken - The token for the next page of results.
 * @param includeLocation - Whether to include location data. Default is false (unless query implies location).
 * @returns A Promise resolving to a filtered list of photos and an optional next page token.
 * @throws Error if the search fails.
 */
export async function searchPhotosByText(
  oauth2Client: OAuth2Client,
  query: string,
  pageSize = 25,
  pageToken?: string,
  includeLocation: boolean = false,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const trimmedQuery = query.trim();
    const filters = buildFiltersFromQuery(trimmedQuery);

    // Auto-enable location if query hints at location search
    const includeLocationSearch =
      includeLocation ||
      /\b(location|place|where|near|at)\b/i.test(trimmedQuery);

    const { photos, nextPageToken } = await searchPhotos(
      oauth2Client,
      {
        pageSize,
        pageToken,
        filters,
      },
      includeLocationSearch,
    );

    // Client-side token filtering
    const tokens = buildSearchTokens(trimmedQuery);
    const filteredPhotos = filterPhotosByTokens(photos, tokens);

    return {
      photos: filteredPhotos,
      nextPageToken,
    };
  } catch (error) {
    const message = toError(error, 'search photos by text').message;
    logger.error(`Failed to search photos by text: ${message}`);
    throw new Error('Failed to search photos by text');
  }
}

/**
 * Searches for photos specifically by location name.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param locationName - The location name to search for.
 * @param pageSize - The number of results to return. Default is 25.
 * @param pageToken - The token for the next page of results.
 * @returns A Promise resolving to a list of photos matching the location.
 * @throws Error if the search fails.
 */
export async function searchPhotosByLocation(
  oauth2Client: OAuth2Client,
  locationName: string,
  pageSize = 25,
  pageToken?: string,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  const normalizedLocation = locationName.trim().toLowerCase();
  try {
    const { photos, nextPageToken } = await searchPhotos(
      oauth2Client,
      {
        pageSize,
        pageToken,
        filters: { mediaTypeFilter: { mediaTypes: ['ALL_MEDIA'] } },
      },
      true, // Always include location for location searches
    );

    // Filter photos that match the location query
    const filtered = photos.filter((photo) => matchesLocationQuery(photo, normalizedLocation));

    return {
      photos: filtered,
      nextPageToken,
    };
  } catch (error) {
    const message = toError(error, 'search photos by location').message;
    logger.error(`Failed to search photos by location: ${message}`);
    throw new Error('Failed to search photos by location');
  }
}
