import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import axios, { AxiosError } from 'axios';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { TokenData } from '../auth/tokens.js';
import { getPhotoLocation, LocationData } from '../utils/location.js';

const photosApi = axios.create({
  baseURL: 'https://photoslibrary.googleapis.com/v1',
  timeout: 15000,
});

function toError(error: unknown, context: string): Error {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: { message?: string } }>;
    const status = axiosError.response?.status;
    const message =
      axiosError.response?.data?.error?.message ||
      axiosError.response?.statusText ||
      axiosError.message;

    // Check for 2025 API scope deprecation errors
    if (status === 403 && message?.includes('PERMISSION_DENIED')) {
      return new Error(
        `Google Photos API ${context} failed (${status}): ${message}. ` +
        'NOTE: As of March 31, 2025, Google Photos API access is limited to app-created content only. ' +
        'For full photo library access, please use the Google Photos Picker API.'
      );
    }

    return new Error(`Google Photos API ${context} failed${status ? ` (${status})` : ''}: ${message}`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function getAuthorizedHeaders(auth: OAuth2Client): Promise<Record<string, string>> {
  try {
    return await auth.getRequestHeaders();
  } catch (error) {
    throw toError(error, 'authorization');
  }
}

interface AlbumsListResponse {
  albums?: Album[];
  nextPageToken?: string;
}

interface MediaItemsSearchResponse {
  mediaItems?: PhotoItem[];
  nextPageToken?: string;
}

interface MediaItemResponse extends PhotoItem {}

export interface PhotoItem {
  id: string;
  baseUrl: string;
  mimeType: string;
  filename: string;
  description?: string;
  productUrl: string;
  mediaMetadata?: {
    creationTime: string;
    width: string;
    height: string;
    photo?: {
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: number;
      apertureFNumber?: number;
      isoEquivalent?: number;
    };
    video?: {
      cameraMake?: string;
      cameraModel?: string;
      fps?: number;
      status?: string;
    };
  };
  locationData?: LocationData;
}

export interface Album {
  id: string;
  title: string;
  productUrl: string;
  mediaItemsCount?: string;
  coverPhotoBaseUrl?: string;
  coverPhotoMediaItemId?: string;
}

export interface SearchFilter {
  dateFilter?: {
    dates?: Array<{
      year: number;
      month?: number;
      day?: number;
    }>;
    ranges?: Array<{
      startDate: {
        year: number;
        month: number;
        day: number;
      };
      endDate: {
        year: number;
        month: number;
        day: number;
      };
    }>;
  };
  contentFilter?: {
    includedContentCategories?: string[];
    excludedContentCategories?: string[];
  };
  mediaTypeFilter?: {
    mediaTypes: Array<'ALL_MEDIA' | 'VIDEO' | 'PHOTO'>;
  };
  featureFilter?: {
    includedFeatures: string[];
  };
  includeArchivedMedia?: boolean;
  excludeNonAppCreatedData?: boolean;
}

export interface SearchParams {
  albumId?: string;
  pageSize?: number;
  pageToken?: string;
  filters?: SearchFilter;
}

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function setupOAuthClient(tokens: TokenData): OAuth2Client {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  return oauth2Client;
}

function createPhotosLibraryClient(auth: OAuth2Client) {
  return {
    albums: {
      list: async (params: { pageSize?: number; pageToken?: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.get<AlbumsListResponse>('/albums', {
            params,
            headers,
          });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.list');
        }
      },
      get: async (params: { albumId: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.get<Album>(`/albums/${params.albumId}`, {
            headers,
          });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.get');
        }
      },
    },
    mediaItems: {
      search: async (params: {
        requestBody: {
          albumId?: string;
          pageSize?: number;
          pageToken?: string;
          filters?: SearchFilter;
        };
      }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post<MediaItemsSearchResponse>(
            '/mediaItems:search',
            params.requestBody,
            { headers },
          );
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'mediaItems.search');
        }
      },
      get: async (params: { mediaItemId: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.get<MediaItemResponse>(`/mediaItems/${params.mediaItemId}`, {
            headers,
          });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'mediaItems.get');
        }
      },
    },
  };
}

export function getPhotoClient(auth: OAuth2Client) {
  return createPhotosLibraryClient(auth);
}

function buildSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .flatMap((token) => token.split(':'))
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function matchesSearchTokens(photo: PhotoItem, tokens: string[]): boolean {
  if (tokens.length === 0) {
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

  for (const token of tokens) {
    for (const value of haystack) {
      if (value.includes(token)) {
        matchedTokens.add(token);
        break;
      }
    }
  }

  return matchedTokens.size > 0;
}

export function filterPhotosByTokens(photos: PhotoItem[], tokens: string[]): PhotoItem[] {
  if (tokens.length === 0) {
    return photos;
  }

  const filtered = photos.filter((photo) => matchesSearchTokens(photo, tokens));

  if (filtered.length === 0) {
    return photos;
  }

  return filtered;
}

function matchesLocationQuery(photo: PhotoItem, locationQuery: string): boolean {
  if (!locationQuery) {
    return true;
  }

  const location = photo.locationData;
  if (!location) {
    return false;
  }

  const normalized = locationQuery.toLowerCase();
  const fields = [
    location.locationName,
    location.formattedAddress,
    location.city,
    location.countryName,
    location.region,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return fields.some((value) => value.includes(normalized));
}

async function enrichPhotosWithLocation(photos: PhotoItem[], includeLocation: boolean, performGeocoding: boolean): Promise<PhotoItem[]> {
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

function buildFiltersFromQuery(query: string): SearchFilter {
  const filters: SearchFilter = {};
  const categoriesMap: Record<string, string> = {
    landscapes: 'LANDSCAPES',
    selfie: 'SELFIES',
    selfies: 'SELFIES',
    portrait: 'PORTRAITS',
    portraits: 'PORTRAITS',
    animal: 'ANIMALS',
    animals: 'ANIMALS',
    pet: 'PETS',
    pets: 'PETS',
    flower: 'FLOWERS',
    flowers: 'FLOWERS',
    food: 'FOOD',
    travel: 'TRAVEL',
    city: 'CITYSCAPES',
    cityscape: 'CITYSCAPES',
    landmark: 'LANDMARKS',
    document: 'DOCUMENTS',
    documents: 'DOCUMENTS',
    screenshot: 'SCREENSHOTS',
    screenshots: 'SCREENSHOTS',
    utility: 'UTILITY',
  };

  const includedCategories = new Set<string>();
  const lowerQuery = query.toLowerCase();
  Object.entries(categoriesMap).forEach(([term, category]) => {
    if (lowerQuery.includes(term)) {
      includedCategories.add(category);
    }
  });

  if (includedCategories.size > 0) {
    filters.contentFilter = {
      includedContentCategories: Array.from(includedCategories),
    };
  }

  const yearRegex = /\b(20\d{2})\b/g;
  const yearMonthRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/g;
  const dateRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])\b/g;

  const dates: Array<{ year: number; month?: number; day?: number }> = [];
  const fullDateMatches = [...query.matchAll(dateRegex)];
  if (fullDateMatches.length > 0) {
    for (const match of fullDateMatches) {
      dates.push({
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
      });
    }
  } else {
    const yearMonthMatches = [...query.matchAll(yearMonthRegex)];
    if (yearMonthMatches.length > 0) {
      for (const match of yearMonthMatches) {
        dates.push({
          year: parseInt(match[1], 10),
          month: parseInt(match[2], 10),
        });
      }
    } else {
      const yearMatches = [...query.matchAll(yearRegex)];
      if (yearMatches.length > 0) {
        for (const match of yearMatches) {
          dates.push({
            year: parseInt(match[1], 10),
          });
        }
      }
    }
  }

  if (dates.length > 0) {
    filters.dateFilter = { dates };
  }

  const mediaTypes = new Set<'ALL_MEDIA' | 'VIDEO' | 'PHOTO'>();
  if (lowerQuery.includes('video')) {
    mediaTypes.add('VIDEO');
  }
  if (lowerQuery.includes('photo') || lowerQuery.includes('image')) {
    mediaTypes.add('PHOTO');
  }

  if (mediaTypes.size > 0) {
    filters.mediaTypeFilter = { mediaTypes: Array.from(mediaTypes) };
  }

  const includedFeatures: string[] = [];
  if (lowerQuery.includes('favorite')) {
    includedFeatures.push('FAVORITES');
  }
  if (includedFeatures.length > 0) {
    filters.featureFilter = { includedFeatures };
  }

  if (
    !filters.contentFilter &&
    !filters.dateFilter &&
    !filters.mediaTypeFilter &&
    !filters.featureFilter
  ) {
    filters.mediaTypeFilter = { mediaTypes: ['ALL_MEDIA'] };
  }

  return filters;
}

export async function listAlbums(
  oauth2Client: OAuth2Client,
  pageSize = 50,
  pageToken?: string,
): Promise<{ albums: Album[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.albums.list({
      pageSize,
      pageToken,
    });

    return {
      albums: response.data.albums ?? [],
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    const message = toError(error, 'list albums').message;
    logger.error(`Failed to list albums: ${message}`);
    throw new Error('Failed to list albums');
  }
}

export async function getAlbum(oauth2Client: OAuth2Client, albumId: string): Promise<Album> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.albums.get({
      albumId,
    });

    if (!response.data) {
      throw new Error('Album not found');
    }

    return response.data as Album;
  } catch (error) {
    const message = toError(error, 'get album').message;
    logger.error(`Failed to get album: ${message}`);
    throw new Error('Failed to get album');
  }
}

export async function searchPhotos(
  oauth2Client: OAuth2Client,
  params: SearchParams,
  includeLocation: boolean = false,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.mediaItems.search({
      requestBody: {
        albumId: params.albumId,
        pageSize: params.pageSize ?? 25,
        pageToken: params.pageToken,
        filters: params.filters,
      },
    });

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

export async function getPhoto(
  oauth2Client: OAuth2Client,
  photoId: string,
  includeLocation: boolean = true,
): Promise<PhotoItem> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.mediaItems.get({
      mediaItemId: photoId,
    });

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
    const message = toError(error, 'download photo data').message;
    logger.error(`Failed to get photo as base64: ${message}`);
    throw new Error('Failed to get photo as base64');
  }
}

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
      true,
    );

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
