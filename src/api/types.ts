/**
 * Type definitions for Google Photos API
 */

/**
 * Response from Google Photos API when listing albums
 */
export interface AlbumsListResponse {
  albums?: Album[];
  nextPageToken?: string;
}

/**
 * Response from Google Photos API when searching media items
 */
export interface MediaItemsSearchResponse {
  mediaItems?: PhotoItem[];
  nextPageToken?: string;
}

/**
 * Response from Google Photos API when fetching a single media item
 */
export interface MediaItemResponse extends PhotoItem {}

/**
 * Represents a photo item from Google Photos API.
 * Includes metadata, media information, and optional location data.
 */
export interface PhotoItem {
  /** Unique identifier for the photo */
  id: string;
  /** Filename of the photo */
  filename: string;
  /** MIME type of the media (e.g., 'image/jpeg', 'video/mp4') */
  mimeType?: string;
  /** Optional description or caption */
  description?: string;
  /** URL to access the photo (time-limited) */
  baseUrl: string;
  /** URL to view the photo in Google Photos web interface */
  productUrl: string;
  /** Media metadata (dimensions, creation time) */
  mediaMetadata?: {
    creationTime?: string;
    width?: string;
    height?: string;
    photo?: {
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: number;
      apertureFNumber?: number;
      isoEquivalent?: number;
    };
  };
  /** Location data (enriched from descriptions or EXIF) */
  locationData?: {
    latitude?: number;
    longitude?: number;
    locationName?: string;
    formattedAddress?: string;
    city?: string;
    countryName?: string;
    region?: string;
    approximate: boolean;
  };
}

/**
 * Represents an album from Google Photos API
 */
export interface Album {
  /** Unique identifier for the album */
  id: string;
  /** Title of the album */
  title: string;
  /** URL to view the album in Google Photos */
  productUrl: string;
  /** Number of items in the album */
  mediaItemsCount?: string;
  /** Base URL for the album cover photo */
  coverPhotoBaseUrl?: string;
}

/**
 * Search filter for Google Photos API
 */
export interface SearchFilter {
  /** Date range filter */
  dateFilter?: {
    ranges?: Array<{
      startDate: { year: number; month: number; day: number };
      endDate: { year: number; month: number; day: number };
    }>;
    dates?: Array<{
      year: number;
      month?: number;
      day?: number;
    }>;
  };
  /** Content category filter */
  contentFilter?: {
    includedContentCategories?: string[];
    excludedContentCategories?: string[];
  };
  /** Media type filter (photo/video) */
  mediaTypeFilter?: {
    mediaTypes?: string[];
  };
  /** Feature filter (favorites, archived, etc.) */
  featureFilter?: {
    includedFeatures?: string[];
  };
}

/**
 * Parameters for searching photos
 */
export interface SearchParams {
  /** Album ID to search within */
  albumId?: string;
  /** Search filters */
  filters?: SearchFilter;
  /** Page size (max 100) */
  pageSize?: number;
  /** Page token for pagination */
  pageToken?: string;
}
