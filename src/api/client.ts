import { OAuth2Client } from 'google-auth-library';
import axios, { AxiosError } from 'axios';
import https from 'https';
import { getAuthorizedHeaders } from './oauth.js';
import {
  Album,
  AlbumsListResponse,
  MediaItemsSearchResponse,
  MediaItemResponse,
  SearchFilter,
} from './types.js';

/**
 * Axios instance configured for Google Photos API
 */
const photosApi = axios.create({
  baseURL: 'https://photoslibrary.googleapis.com/v1',
  timeout: 15000,
  // Optimization: Enable keep-alive to reuse TCP connections for better performance
  httpsAgent: new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,    // Send keep-alive packets every 30s
    maxSockets: 50,           // Max concurrent connections per host
    maxFreeSockets: 10,       // Max idle connections to keep open
    timeout: 60000,           // Socket idle timeout (60s)
  }),
});

/**
 * Converts an error into a standardized Error object with a descriptive message.
 * Handles Axios errors and specific Google Photos API issues (like the 2025 scope deprecation).
 *
 * @param error - The original error object.
 * @param context - A string describing what operation failed (e.g., 'search photos').
 * @returns A standardized Error object.
 */
export function toError(error: unknown, context: string): Error {
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
    return new Error(`Google Photos API ${context} failed: ${error.message}`);
  }

  return new Error(`Google Photos API ${context} failed: ${String(error)}`);
}

/**
 * Internal helper to create a wrapper around the Google Photos API using Axios.
 * This wrapper handles authorization and type safety for specific endpoints.
 *
 * @param auth - The authenticated OAuth2 client.
 * @returns An object with methods to interact with albums and media items.
 */
export function createPhotosLibraryClient(auth: OAuth2Client) {
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

/**
 * Factory function to get the Photos Library client.
 *
 * @param auth - The authenticated OAuth2 client.
 * @returns The Photos Library client wrapper.
 */
export function getPhotoClient(auth: OAuth2Client) {
  return createPhotosLibraryClient(auth);
}
