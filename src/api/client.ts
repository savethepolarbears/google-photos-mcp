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
  BatchCreateResponse,
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
function createPhotosLibraryClient(auth: OAuth2Client) {
  return {
    uploads: {
      upload: async (params: { bytes: Buffer; mimeType: string; fileName: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post<string>('/uploads', params.bytes, {
            headers: {
              ...headers,
              'Content-type': 'application/octet-stream',
              'X-Goog-Upload-Content-Type': params.mimeType,
              'X-Goog-Upload-Protocol': 'raw',
            },
            responseType: 'text',
          });
          return { uploadToken: response.data as string };
        } catch (error) {
          throw toError(error, 'uploads.upload');
        }
      },
    },
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
      create: async (params: { title: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post<Album>('/albums', { album: { title: params.title } }, { headers });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.create');
        }
      },
      batchAddMediaItems: async (params: { albumId: string; mediaItemIds: string[] }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post(
            `/albums/${params.albumId}:batchAddMediaItems`,
            { mediaItemIds: params.mediaItemIds },
            { headers }
          );
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.batchAddMediaItems');
        }
      },
      addEnrichment: async (params: {
        albumId: string;
        albumPosition?: { position: string };
        newEnrichmentItem: Record<string, unknown>;
      }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post(
            `/albums/${params.albumId}:addEnrichment`,
            { newEnrichmentItem: params.newEnrichmentItem, albumPosition: params.albumPosition },
            { headers },
          );
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.addEnrichment');
        }
      },
      patch: async (params: {
        albumId: string;
        updateMask: string;
        requestBody: Record<string, unknown>;
      }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.patch<Album>(
            `/albums/${params.albumId}`,
            params.requestBody,
            { params: { updateMask: params.updateMask }, headers },
          );
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'albums.patch');
        }
      },
    },
    mediaItems: {
      batchCreate: async (params: {
        albumId?: string;
        newMediaItems: Array<{ uploadToken: string; fileName?: string; description?: string }>;
      }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.post<BatchCreateResponse>(
            '/mediaItems:batchCreate',
            {
              albumId: params.albumId,
              newMediaItems: params.newMediaItems.map(item => ({
                description: item.description,
                simpleMediaItem: { uploadToken: item.uploadToken, fileName: item.fileName },
              })),
            },
            { headers },
          );
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'mediaItems.batchCreate');
        }
      },
      search: async (params: {
        requestBody: {
          albumId?: string;
          pageSize?: number;
          pageToken?: string;
          filters?: SearchFilter;
          orderBy?: string;
          includeArchivedMedia?: boolean;
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
      list: async (params: { pageSize?: number; pageToken?: string }) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await photosApi.get<MediaItemsSearchResponse>('/mediaItems', {
            params,
            headers,
          });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'mediaItems.list');
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

/**
 * Axios instance configured for Google Photos Picker API
 */
const pickerApi = axios.create({
  baseURL: 'https://photospicker.googleapis.com/v1',
  timeout: 15000,
});

/**
 * Creates a wrapper around the Google Photos Picker API.
 * Provides methods for session management and media item retrieval.
 *
 * @param auth - The authenticated OAuth2 client (must have photospicker.mediaitems.readonly scope).
 * @returns An object with methods for Picker API sessions.
 */
export function getPickerClient(auth: OAuth2Client) {
  return {
    sessions: {
      create: async () => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await pickerApi.post('/sessions', {}, { headers });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'picker.sessions.create');
        }
      },
      get: async (sessionId: string) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await pickerApi.get(`/sessions/${sessionId}`, { headers });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'picker.sessions.get');
        }
      },
      listMediaItems: async (sessionId: string, params: { pageSize?: number; pageToken?: string } = {}) => {
        try {
          const headers = await getAuthorizedHeaders(auth);
          const response = await pickerApi.get(`/sessions/${sessionId}/mediaItems`, { params, headers });
          return { data: response.data };
        } catch (error) {
          throw toError(error, 'picker.sessions.listMediaItems');
        }
      },
    },
  };
}
