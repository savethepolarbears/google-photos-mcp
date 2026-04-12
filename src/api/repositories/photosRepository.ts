import { OAuth2Client } from "google-auth-library";
import axios from "axios";
import { readFile } from "fs/promises";
import { PhotoItem, SearchParams, NewMediaItemResult } from "../types.js";
import { getPhotoClient, getPickerClient, toError } from "../client.js";
import { enrichPhotosWithLocation } from "../enrichment/locationEnricher.js";
import { getPhotoLocation } from "../../utils/location.js";
import { withRetry } from "../../utils/retry.js";
import logger from "../../utils/logger.js";

/**
 * Photo repository for CRUD operations
 */

/**
 * Searches for photos using the Google Photos API search endpoint.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param params - The search parameters (filters, albumId, etc.).
 * @param includeLocation - Whether to enrich photos with location data. Default is false.
 * @returns A Promise resolving to a list of photos and an optional next page token.
 * @throws Error if the search fails.
 */
export async function searchPhotos(
  oauth2Client: OAuth2Client,
  params: SearchParams,
  includeLocation: boolean = false,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () =>
        await photosClient.mediaItems.search({
          requestBody: {
            albumId: params.albumId,
            pageSize: params.pageSize ?? 25,
            pageToken: params.pageToken,
            filters: params.filters,
            orderBy: params.orderBy,
            includeArchivedMedia: params.includeArchivedMedia,
          },
        }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "search photos",
    );

    const photos = (response.data.mediaItems ?? []) as PhotoItem[];
    await enrichPhotosWithLocation(photos, includeLocation, false);

    return {
      photos,
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    const message = toError(error, "search photos").message;
    logger.error(`Failed to search photos: ${message}`);
    throw new Error("Failed to search photos", { cause: error });
  }
}

/**
 * Lists photos from a specific album.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param albumId - The ID of the album.
 * @param pageSize - The number of photos to retrieve per page. Default is 25.
 * @param pageToken - The token for the next page of results.
 * @param includeLocation - Whether to include location data. Default is false.
 * @returns A Promise resolving to a list of photos and an optional next page token.
 * @throws Error if listing album photos fails.
 */
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
    const message = toError(error, "list album photos").message;
    logger.error(`Failed to list album photos: ${message}`);
    throw new Error("Failed to list album photos", { cause: error });
  }
}

/**
 * Lists all media items from the Google Photos library without album filtering.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param pageSize - The number of photos to retrieve per page. Default is 25.
 * @param pageToken - The token for the next page of results.
 * @returns A Promise resolving to a list of photos and an optional next page token.
 * @throws Error if listing media items fails.
 */
export async function listMediaItems(
  oauth2Client: OAuth2Client,
  pageSize = 25,
  pageToken?: string,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);
    const response = await withRetry(
      async () => await photosClient.mediaItems.list({ pageSize, pageToken }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "list media items",
    );
    return {
      photos: (response.data.mediaItems ?? []) as PhotoItem[],
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    const message = toError(error, "list media items").message;
    logger.error(`Failed to list media items: ${message}`);
    throw new Error("Failed to list media items", { cause: error });
  }
}

/**
 * Gets a specific photo by its ID.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param photoId - The ID of the photo to retrieve.
 * @param includeLocation - Whether to include location data. Default is true.
 * @returns A Promise resolving to the PhotoItem object.
 * @throws Error if the photo is not found or request fails.
 */
export async function getPhoto(
  oauth2Client: OAuth2Client,
  photoId: string,
  includeLocation: boolean = true,
): Promise<PhotoItem> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    // Apply retry logic per Google Photos API best practices
    const response = await withRetry(
      async () =>
        await photosClient.mediaItems.get({
          mediaItemId: photoId,
        }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "get photo",
    );

    if (!response.data) {
      throw new Error("Photo not found");
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
    const message = toError(error, "get photo").message;
    logger.error(`Failed to get photo: ${message}`);
    throw new Error("Failed to get photo", { cause: error });
  }
}

/**
 * Downloads a photo and returns it as a Base64 string.
 *
 * @param url - The URL of the photo (usually the baseUrl from a PhotoItem).
 * @returns A Promise resolving to the Base64 encoded string of the image.
 * @throws Error if the download fails.
 */
export async function getPhotoAsBase64(url: string): Promise<string> {
  if (!url) {
    throw new Error("Invalid photo URL");
  }

  try {
    const fullResUrl = `${url}=d`;
    const response = await axios.get<ArrayBuffer>(fullResUrl, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data);
    return buffer.toString("base64");
  } catch (error) {
    logger.error(
      `Failed to download photo: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new Error("Failed to download photo", { cause: error });
  }
}

/**
 * Uploads media from a local file and creates a Google Photos media item.
 * Atomic two-step process: uploads bytes to get token, then batch creates.
 */
export async function uploadMedia(
  oauth2Client: OAuth2Client,
  filePath: string,
  mimeType: string,
  fileName: string,
  albumId?: string,
  description?: string,
): Promise<{ mediaItemId: string; uploadToken: string }> {
  try {
    const bytes = await readFile(filePath);
    const photosClient = getPhotoClient(oauth2Client);

    const { uploadToken } = await withRetry(
      async () =>
        await photosClient.uploads.upload({ bytes, mimeType, fileName }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "upload media bytes",
    );

    const result = await photosClient.mediaItems.batchCreate({
      albumId,
      newMediaItems: [{ uploadToken, fileName, description }],
    });

    const mediaItemResult = result.data.newMediaItemResults?.[0];
    return {
      mediaItemId: mediaItemResult?.mediaItem?.id ?? "",
      uploadToken,
    };
  } catch (error) {
    logger.error(
      `Failed to upload media: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new Error("Failed to upload media", { cause: error });
  }
}

/**
 * Creates media items from existing upload tokens.
 */
export async function batchCreateMediaItems(
  oauth2Client: OAuth2Client,
  newMediaItems: Array<{
    uploadToken: string;
    fileName?: string;
    description?: string;
  }>,
  albumId?: string,
): Promise<{ mediaItems: NewMediaItemResult[] }> {
  try {
    const photosClient = getPhotoClient(oauth2Client);

    const response = await withRetry(
      async () =>
        await photosClient.mediaItems.batchCreate({ newMediaItems, albumId }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "batch create media items",
    );

    return { mediaItems: response.data.newMediaItemResults || [] };
  } catch (error) {
    logger.error(
      `Failed to batch create media items: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new Error("Failed to batch create media items", { cause: error });
  }
}

// ── Google Photos Picker API ──────────────────────────────────────────

/**
 * Creates a new Picker session. Returns the session ID and the `pickerUri`
 * that the user must visit to select photos from their full library.
 */
export async function createPickerSession(
  oauth2Client: OAuth2Client,
): Promise<{ id: string; pickerUri: string }> {
  const client = getPickerClient(oauth2Client);
  const response = await withRetry(
    () => client.sessions.create(),
    { maxRetries: 3, initialDelayMs: 1000 },
    "create picker session",
  );
  return response.data as { id: string; pickerUri: string };
}

/**
 * Polls an existing Picker session to check whether the user has completed selection.
 */
export async function getPickerSession(
  oauth2Client: OAuth2Client,
  sessionId: string,
): Promise<{ id: string; pickerUri: string; mediaItemsSet: boolean }> {
  const client = getPickerClient(oauth2Client);
  const response = await withRetry(
    () => client.sessions.get(sessionId),
    { maxRetries: 3, initialDelayMs: 1000 },
    "get picker session",
  );
  return response.data as {
    id: string;
    pickerUri: string;
    mediaItemsSet: boolean;
  };
}

/**
 * Lists media items selected by the user in a completed Picker session.
 * Maps the Picker `mediaFile` schema to this project's `PhotoItem` interface.
 */
export async function listPickerSessionMediaItems(
  oauth2Client: OAuth2Client,
  sessionId: string,
  pageSize = 25,
  pageToken?: string,
): Promise<{ photos: PhotoItem[]; nextPageToken?: string }> {
  const client = getPickerClient(oauth2Client);
  const response = await withRetry(
    () => client.sessions.listMediaItems(sessionId, { pageSize, pageToken }),
    { maxRetries: 3, initialDelayMs: 1000 },
    "list picker media",
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = response.data.mediaItems || [];

  const photos = items.map((item) => ({
    id: item.mediaFile?.mediaFileId ?? item.id ?? "",
    filename: item.mediaFile?.filename ?? "",
    baseUrl: item.mediaFile?.baseUrl ?? "",
    productUrl: item.mediaFile?.baseUrl ?? "",
    mimeType: item.mediaFile?.mimeType,
  })) as PhotoItem[];

  return { photos, nextPageToken: response.data.nextPageToken };
}
