import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import config from '../utils/config';
import logger from '../utils/logger';
import { TokenData } from '../auth/tokens';
import { getPhotoLocation, LocationData } from '../utils/location';

// Photo item structure returned by the API
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
  // Location information if available
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
  contentCategory?: string;
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
  mediaTypeFilter?: {
    mediaTypes: string[];
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

// Create OAuth client helper function
export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Set up OAuth client with tokens
export function setupOAuthClient(tokens: TokenData): OAuth2Client {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  return oauth2Client;
}

// Fix the function to create the photoslibrary client
function createPhotosLibraryClient(auth: OAuth2Client) {
  // Dynamically access the photosLibrary API
  return {
    albums: {
      list: async (params: any) => {
        // Make a direct API call since the type system doesn't recognize the client
        const url = `https://photoslibrary.googleapis.com/v1/albums`;
        const headers = {
          Authorization: `Bearer ${(await auth.getAccessToken()).token}`
        };
        const response = await axios.get(url, { params, headers });
        return response.data;
      },
      get: async (params: any) => {
        const url = `https://photoslibrary.googleapis.com/v1/albums/${params.albumId}`;
        const headers = {
          Authorization: `Bearer ${(await auth.getAccessToken()).token}`
        };
        const response = await axios.get(url, { headers });
        return response.data;
      }
    },
    mediaItems: {
      search: async (params: any) => {
        const url = `https://photoslibrary.googleapis.com/v1/mediaItems:search`;
        const headers = {
          Authorization: `Bearer ${(await auth.getAccessToken()).token}`
        };
        const response = await axios.post(url, params.requestBody, { headers });
        return response.data;
      },
      get: async (params: any) => {
        const url = `https://photoslibrary.googleapis.com/v1/mediaItems/${params.mediaItemId}`;
        const headers = {
          Authorization: `Bearer ${(await auth.getAccessToken()).token}`
        };
        const response = await axios.get(url, { headers });
        return response.data;
      }
    }
  };
}

// Replace the direct photoslibrary call with the function
export function getPhotoClient(auth: OAuth2Client) {
  // Use our custom function to create the client
  return createPhotosLibraryClient(auth);
}

// List all albums
export async function listAlbums(
  oauth2Client: OAuth2Client,
  pageSize = 50,
  pageToken?: string
): Promise<{ albums: Album[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.albums.list({
      pageSize,
      pageToken,
    });

    return {
      albums: response.data.albums || [],
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    logger.error(`Failed to list albums: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to list albums');
  }
}

// Get a specific album
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
    logger.error(`Failed to get album: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to get album');
  }
}

// Search for photos with filters
export async function searchPhotos(
  oauth2Client: OAuth2Client,
  params: SearchParams,
  includeLocation: boolean = false
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await photosClient.mediaItems.search({
      requestBody: {
        albumId: params.albumId,
        pageSize: params.pageSize || 25,
        pageToken: params.pageToken,
        filters: params.filters,
      },
    });

    const photos = response.data.mediaItems || [];
    
    // If location data is requested, attempt to get location for each photo
    if (includeLocation && photos.length > 0) {
      // Process in batches to avoid making too many requests at once
      const batchSize = 5;
      for (let i = 0; i < photos.length; i += batchSize) {
        const batch = photos.slice(i, i + batchSize);
        
        // Process each photo in the batch in parallel
        await Promise.all(
          batch.map(async (photo) => {
            try {
              const locationData = await getPhotoLocation(photo, false);
              if (locationData) {
                (photo as PhotoItem).locationData = locationData;
              }
            } catch (locError) {
              // Continue without location data
              logger.debug(`Could not get location for photo ${photo.id}: ${locError instanceof Error ? locError.message : String(locError)}`);
            }
          })
        );
      }
    }

    return {
      photos: photos as PhotoItem[],
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    logger.error(`Failed to search photos: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to search photos');
  }
}

// List photos in an album
export async function listAlbumPhotos(
  oauth2Client: OAuth2Client,
  albumId: string,
  pageSize = 25,
  pageToken?: string,
  includeLocation: boolean = false
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    return await searchPhotos(
      oauth2Client, 
      {
        albumId,
        pageSize,
        pageToken,
      },
      includeLocation
    );
  } catch (error) {
    logger.error(`Failed to list album photos: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to list album photos');
  }
}

// Get a specific photo by ID
export async function getPhoto(
  oauth2Client: OAuth2Client, 
  photoId: string,
  includeLocation: boolean = true
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
    
    // Attempt to get location data if requested
    if (includeLocation) {
      try {
        const locationData = await getPhotoLocation(photo, true);
        if (locationData) {
          photo.locationData = locationData;
        }
      } catch (locError) {
        logger.warn(`Could not get location data for photo ${photoId}: ${locError instanceof Error ? locError.message : String(locError)}`);
        // Continue without location data
      }
    }

    return photo;
  } catch (error) {
    logger.error(`Failed to get photo: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to get photo');
  }
}

// Get a photo as base64 data
export async function getPhotoAsBase64(url: string): Promise<string> {
  try {
    // Append '=d' to get the full-resolution image
    const fullResUrl = `${url}=d`;
    const response = await axios.get(fullResUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    return buffer.toString('base64');
  } catch (error) {
    logger.error(`Failed to get photo as base64: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to get photo as base64');
  }
}

// Search photos by text (content category and date filters)
export async function searchPhotosByText(
  oauth2Client: OAuth2Client,
  query: string,
  pageSize = 25,
  pageToken?: string,
  includeLocation: boolean = false
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const filters: SearchFilter = {};
    
    // Parse query for content categories
    const contentCategories = [
      'landscapes', 'selfies', 'portraits', 'animals',
      'pets', 'flowers', 'food', 'travel', 'cityscapes',
      'landmarks', 'documents', 'screenshots', 'utility'
    ];
    
    for (const category of contentCategories) {
      if (query.toLowerCase().includes(category.toLowerCase())) {
        filters.contentCategory = category.toUpperCase();
        break;
      }
    }
    
    // Parse query for dates (simple formats)
    const yearRegex = /\b(20\d{2})\b/g;
    const yearMonthRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/g;
    const dateRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])\b/g;
    
    const dates = [];
    
    // Check for full dates
    const fullDateMatches = [...query.matchAll(dateRegex)];
    if (fullDateMatches.length > 0) {
      for (const match of fullDateMatches) {
        dates.push({
          year: parseInt(match[1], 10),
          month: parseInt(match[2], 10),
          day: parseInt(match[3], 10),
        });
      }
    } 
    // Check for year/month
    else {
      const yearMonthMatches = [...query.matchAll(yearMonthRegex)];
      if (yearMonthMatches.length > 0) {
        for (const match of yearMonthMatches) {
          dates.push({
            year: parseInt(match[1], 10),
            month: parseInt(match[2], 10),
          });
        }
      } 
      // Check for year only
      else {
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
    
    // Parse query for media types
    const mediaTypes = [];
    if (query.toLowerCase().includes('photo') || query.toLowerCase().includes('image')) {
      mediaTypes.push('PHOTO');
    }
    if (query.toLowerCase().includes('video')) {
      mediaTypes.push('VIDEO');
    }
    
    if (mediaTypes.length > 0) {
      filters.mediaTypeFilter = { mediaTypes };
    }
    
    // Parse query for features
    const features = [];
    if (query.toLowerCase().includes('favorite')) {
      features.push('FAVORITES');
    }
    
    if (features.length > 0) {
      filters.featureFilter = { includedFeatures: features };
    }
    
    // Check for location-related terms
    const includeLocationSearch = includeLocation || 
      query.toLowerCase().includes('location') ||
      query.toLowerCase().includes('place') || 
      query.toLowerCase().includes('where') ||
      query.toLowerCase().includes('near') ||
      query.toLowerCase().includes('at');
    
    return await searchPhotos(
      oauth2Client, 
      {
        pageSize,
        pageToken,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      },
      includeLocationSearch
    );
  } catch (error) {
    logger.error(`Failed to search photos by text: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to search photos by text');
  }
}
