import { PhotoItem } from '../types.js';

/**
 * Search token matching logic for client-side photo filtering
 */

/**
 * Splits a search query into tokens for client-side filtering.
 * Tokens are split by whitespace and colons.
 *
 * @param query - The search query string.
 * @returns An array of string tokens.
 */
export function buildSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .flatMap((token) => token.split(':'))
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Checks if a photo matches a set of search tokens.
 * Matches against filename, description, creation time, and location data.
 *
 * @param photo - The photo to check.
 * @param tokens - The search tokens.
 * @returns True if at least one token matches, false otherwise.
 */
export function matchesSearchTokens(photo: PhotoItem, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const normalizedTokens = tokens
    .map((token) => token.toLowerCase().trim())
    .filter((token) => token.length > 0);

  if (normalizedTokens.length === 0) {
    return true;
  }

  const haystack = [
    photo.filename,
    photo.description,
    photo.mediaMetadata?.creationTime,
    photo.locationData?.locationName,
    photo.locationData?.formattedAddress,
    photo.locationData?.city,
    photo.locationData?.countryName,
    photo.locationData?.region,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (haystack.length === 0) {
    return false;
  }

  const matchedTokens = new Set<string>();

  for (const token of normalizedTokens) {
    for (const value of haystack) {
      if (value.includes(token)) {
        matchedTokens.add(token);
        break;
      }
    }
  }

  return matchedTokens.size > 0;
}

/**
 * Filters a list of photos by search tokens.
 * Returns the filtered list if any photos match, otherwise returns the original list.
 * This prevents returning empty results when search tokens don't match metadata.
 *
 * @param photos - The list of photos to filter.
 * @param tokens - The search tokens.
 * @returns The filtered list of photos, or original list if no matches found.
 */
export function filterPhotosByTokens(photos: PhotoItem[], tokens: string[]): PhotoItem[] {
  if (tokens.length === 0) {
    return photos;
  }

  const filtered = photos.filter((photo) => matchesSearchTokens(photo, tokens));

  // If filtering removes everything, return original list (fallback behavior)
  if (filtered.length === 0) {
    return photos;
  }

  return filtered;
}

/**
 * Checks if a photo matches a specific location query.
 *
 * @param photo - The photo to check.
 * @param locationQuery - The location string to search for.
 * @returns True if the photo's location data matches the query, false otherwise.
 */
export function matchesLocationQuery(photo: PhotoItem, locationQuery: string): boolean {
  if (!locationQuery) {
    return true;
  }

  const query = locationQuery.toLowerCase().trim();

  if (!photo.locationData) {
    return false;
  }

  const locationFields = [
    photo.locationData.locationName,
    photo.locationData.formattedAddress,
    photo.locationData.city,
    photo.locationData.countryName,
    photo.locationData.region,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return locationFields.some((field) => field.includes(query));
}
