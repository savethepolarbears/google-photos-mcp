import { PhotoItem } from '../types.js';
import { getPhotoLocation } from '../../utils/location.js';
import logger from '../../utils/logger.js';

/**
 * Location data enrichment for photos
 */

/**
 * Enriches a list of photos with location data.
 * Can perform optional geocoding if coordinates are missing.
 * Processes photos in batches of 5 to avoid overwhelming the geocoding service.
 *
 * @param photos - The list of photos to enrich.
 * @param includeLocation - Whether to include location data.
 * @param performGeocoding - Whether to perform geocoding for missing coordinates.
 * @returns A Promise resolving to the enriched list of photos.
 */
export async function enrichPhotosWithLocation(
  photos: PhotoItem[],
  includeLocation: boolean,
  performGeocoding: boolean
): Promise<PhotoItem[]> {
  if (!includeLocation || photos.length === 0) {
    return photos;
  }

  const batchSize = 5;
  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (photo) => {
        try {
          const locationData = await getPhotoLocation(photo, performGeocoding);
          if (locationData) {
            photo.locationData = locationData;
          }
        } catch (error) {
          logger.debug(
            `Could not enrich location for photo ${photo.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }

  return photos;
}
