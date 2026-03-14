import axios from 'axios';
import logger from './logger.js';
import { nominatimRateLimiter } from './nominatimRateLimiter.js';

/**
 * Minimal photo interface for location processing.
 * Defines only the fields needed for location extraction.
 */
interface PhotoForLocation {
  id?: string;
  description?: string;
  mediaMetadata?: {
    photo?: Record<string, unknown>;
    creationTime?: string;
  };
  locationData?: LocationData;
}

/**
 * Interface representing location data extracted or enriched for a photo.
 */
interface LocationData {
  /** Latitude coordinate */
  latitude?: number;
  /** Longitude coordinate */
  longitude?: number;
  /** Name of the location (e.g., "Eiffel Tower") */
  locationName?: string;
  /** Full formatted address */
  formattedAddress?: string;
  /** Country name */
  countryName?: string;
  /** City or town name */
  city?: string;
  /** State or region */
  region?: string;
  /** Indicates if the location is approximate (true) or precise (false) */
  approximate: boolean;
}

/**
 * Extract any available location data from a photo object.
 * Note: Google Photos API does not provide precise location data via the API directly.
 * This function attempts to extract location hints from the photo's description.
 *
 * @param photo - The photo object from the Google Photos API.
 * @returns The extracted LocationData or null if no location info found.
 */
function extractLocationFromPhoto(photo: PhotoForLocation): LocationData | null {
  try {
    if (
      !photo || 
      !photo.mediaMetadata ||
      !photo.mediaMetadata.photo ||
      !photo.description
    ) {
      return null;
    }

    // The Google Photos API doesn't directly provide location coordinates
    // But sometimes the description may contain location information that we can extract
    // This is a fallback approach, not guaranteed to work for all photos
    
    const locationData: LocationData = {
      approximate: true,
    };

    // Check description for potential location information
    const description = photo.description || '';
    
    // Look for common location patterns in the description
    // This is very basic and won't work for many cases
    const locationMatch = description.match(/Location:\s*([^,]+),?\s*([^,]+),?\s*([^,]+)/i);
    if (locationMatch) {
      locationData.locationName = locationMatch[1].trim();
      locationData.city = locationMatch[2]?.trim();
      locationData.countryName = locationMatch[3]?.trim();
      locationData.formattedAddress = [locationData.locationName, locationData.city, locationData.countryName]
        .filter(Boolean)
        .join(', ');
    }

    // If we couldn't extract anything meaningful, return null
    if (!locationData.locationName && !locationData.city && !locationData.countryName) {
      return null;
    }

    return locationData;
  } catch (error) {
    logger.error(`Error extracting location data: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Search for location information by name using a free geocoding API (Nominatim).
 * This can be used to supplement location data extraction or for searching.
 *
 * @param locationName - The name of the location to search for (e.g., "Paris").
 * @returns A Promise resolving to LocationData or null if not found.
 */
async function searchLocationByName(locationName: string): Promise<LocationData | null> {
  try {
    // Use a free geocoding API (Nominatim/OpenStreetMap)
    // Rate limited to 1 req/sec per Nominatim usage policy
    const response = await nominatimRateLimiter.throttle(async () =>
      axios.get(`https://nominatim.openstreetmap.org/search`, {
        params: {
          q: locationName,
          format: 'json',
          limit: 1
        },
        headers: {
          'User-Agent': 'Google-Photos-MCP-Server/1.0'
        }
      })
    );

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        locationName: result.display_name.split(',')[0],
        formattedAddress: result.display_name,
        countryName: result.address?.country,
        city: result.address?.city || result.address?.town || result.address?.village,
        region: result.address?.state,
        approximate: true
      };
    }

    return null;
  } catch (error) {
    logger.error(`Error searching location by name: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Reverse geocode latitude/longitude coordinates to a human-readable LocationData
 * using Nominatim's /reverse endpoint.
 *
 * NOTE: Google Photos REST API does NOT return GPS coordinates in its responses.
 * This function is useful only for user-provided coordinates or app-stored
 * LocationEnrichment data that explicitly includes lat/lng.
 *
 * @param lat - Latitude coordinate.
 * @param lng - Longitude coordinate.
 * @returns A Promise resolving to LocationData or null on error or empty response.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<LocationData | null> {
  try {
    const response = await nominatimRateLimiter.throttle(async () =>
      axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat, lon: lng, format: 'json' },
        headers: { 'User-Agent': 'Google-Photos-MCP-Server/1.0' },
      })
    );

    const r = response.data;
    if (!r || r.error) {
      return null;
    }

    return {
      latitude: lat,
      longitude: lng,
      locationName: r.name || r.display_name?.split(',')[0],
      formattedAddress: r.display_name,
      countryName: r.address?.country,
      city: r.address?.city || r.address?.town || r.address?.village,
      region: r.address?.state,
      approximate: false,
    };
  } catch (error) {
    logger.error(`Error reverse geocoding (${lat}, ${lng}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get the approximate location data for a photo by its ID.
 * This combines extraction from photo metadata with optional geocoding lookup.
 *
 * @param photo - The photo object.
 * @param performGeocoding - Whether to perform a geocoding lookup if coordinates are missing but a location name is found. Default is false.
 * @returns A Promise resolving to LocationData or null if no location data is available.
 */
export async function getPhotoLocation(
  photo: PhotoForLocation,
  performGeocoding: boolean = false
): Promise<LocationData | null> {
  try {
    // Try to extract location from photo metadata first; fall back to photo.locationData
    const locationData = extractLocationFromPhoto(photo) ?? photo.locationData ?? null;

    // If we have a location name but want coordinates, try forward geocoding
    if (
      performGeocoding &&
      locationData &&
      locationData.locationName &&
      (!locationData.latitude || !locationData.longitude)
    ) {
      const searchQuery = [
        locationData.locationName,
        locationData.city,
        locationData.countryName
      ].filter(Boolean).join(', ');

      const geocodedLocation = await searchLocationByName(searchQuery);

      if (geocodedLocation) {
        return {
          ...locationData,
          latitude: geocodedLocation.latitude,
          longitude: geocodedLocation.longitude,
          // Keep existing values if available
          city: locationData.city || geocodedLocation.city,
          countryName: locationData.countryName || geocodedLocation.countryName,
          region: locationData.region || geocodedLocation.region,
          // Always mark as approximate
          approximate: true
        };
      }
    }

    // Reverse geocode: if we have coords but no location name, enrich with city/country
    if (
      performGeocoding &&
      locationData &&
      locationData.latitude &&
      locationData.longitude &&
      !locationData.locationName &&
      !locationData.city &&
      !locationData.countryName
    ) {
      const reverseResult = await reverseGeocode(locationData.latitude, locationData.longitude);
      if (reverseResult) {
        return {
          ...locationData,
          locationName: reverseResult.locationName,
          formattedAddress: reverseResult.formattedAddress,
          city: reverseResult.city,
          countryName: reverseResult.countryName,
          region: reverseResult.region,
          // Keep approximate from original (coords came from metadata, not geocoding)
          approximate: locationData.approximate,
        };
      }
    }

    return locationData;
  } catch (error) {
    logger.error(`Error getting photo location: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
