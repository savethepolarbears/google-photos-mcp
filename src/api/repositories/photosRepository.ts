import { OAuth2Client } from "google-auth-library";
import axios from "axios";
import { readFile, writeFile } from "fs/promises";
import fs from "fs";
import path from "path";
import {
  PhotoItem,
  SearchParams,
  NewMediaItemResult,
  PickerSession,
} from "../types.js";
import {
  getPhotoClient,
  getPickerClient,
  httpsAgent,
  toError,
} from "../client.js";
import { getAuthorizedHeaders } from "../oauth.js";
import { enrichPhotosWithLocation } from "../enrichment/locationEnricher.js";
import { getPhotoLocation } from "../../utils/location.js";
import { withRetry } from "../../utils/retry.js";
import logger from "../../utils/logger.js";
import { quotaManager } from "../../utils/quotaManager.js";

/**
 * Validates that a baseUrl uses HTTPS and targets an official Google Photos media host.
 * Protects against SSRF and OAuth bearer token exfiltration.
 *
 * @param urlString - The URL string to validate.
 * @returns True if valid HTTPS Google Photos media URL.
 */
export function isAllowedGooglePhotosMediaUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return (
      host === "photoslibrary.googleapis.com" ||
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com") ||
      host === "photos.google.com" ||
      host.endsWith(".photos.google.com")
    );
  } catch {
    return false;
  }
}

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
    throw new Error(`Failed to search photos: ${message}`, { cause: error });
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
    throw new Error(`Failed to list album photos: ${message}`, {
      cause: error,
    });
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
    throw new Error(`Failed to list media items: ${message}`, { cause: error });
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
    throw new Error(`Failed to get photo: ${message}`, { cause: error });
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
    const message =
      error instanceof Error
        ? error.message
        : toError(error, "download photo").message;
    logger.error(`Failed to download photo: ${message}`);
    throw new Error(`Failed to download photo: ${message}`, { cause: error });
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
    const message =
      error instanceof Error
        ? error.message
        : toError(error, "upload media").message;
    logger.error(`Failed to upload media: ${message}`);
    throw new Error(`Failed to upload media: ${message}`, { cause: error });
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
    const message =
      error instanceof Error
        ? error.message
        : toError(error, "batch create media items").message;
    logger.error(`Failed to batch create media items: ${message}`);
    throw new Error(`Failed to batch create media items: ${message}`, {
      cause: error,
    });
  }
}

// ── Google Photos Picker API ──────────────────────────────────────────

/**
 * Creates a new Picker session. Returns the session ID and the `pickerUri`
 * that the user must visit to select photos from their full library.
 */
export async function createPickerSession(
  oauth2Client: OAuth2Client,
  options?: { maxItemCount?: number },
): Promise<PickerSession> {
  const client = getPickerClient(oauth2Client);
  const response = await withRetry(
    () => client.sessions.create(options),
    { maxRetries: 3, initialDelayMs: 1000 },
    "create picker session",
  );
  return response.data as PickerSession;
}

/**
 * Polls an existing Picker session to check whether the user has completed selection.
 */
export async function getPickerSession(
  oauth2Client: OAuth2Client,
  sessionId: string,
): Promise<PickerSession> {
  const client = getPickerClient(oauth2Client);
  const response = await withRetry(
    () => client.sessions.get(sessionId),
    { maxRetries: 3, initialDelayMs: 1000 },
    "get picker session",
  );
  return response.data as PickerSession;
}

/**
 * Deletes a Picker session after media items are retrieved or if the session timed out.
 */
export async function deletePickerSession(
  oauth2Client: OAuth2Client,
  sessionId: string,
): Promise<void> {
  const client = getPickerClient(oauth2Client);
  await withRetry(
    () => client.sessions.delete(sessionId),
    { maxRetries: 3, initialDelayMs: 1000 },
    "delete picker session",
  );
}

interface PickerMediaItem {
  id?: string;
  createTime?: string;
  type?: "PHOTO" | "VIDEO" | "TYPE_UNSPECIFIED";
  mediaFile?: {
    mediaFileId?: string;
    filename?: string;
    baseUrl?: string;
    mimeType?: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
      photoMetadata?: Record<string, unknown>;
      videoMetadata?: Record<string, unknown>;
    };
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

  const items = (response.data.mediaItems || []) as PickerMediaItem[];

  const photos = items.map((item) => ({
    id: item.id ?? item.mediaFile?.mediaFileId ?? "",
    filename: item.mediaFile?.filename ?? "",
    baseUrl: item.mediaFile?.baseUrl ?? "",
    productUrl: item.mediaFile?.baseUrl ?? "",
    mimeType: item.mediaFile?.mimeType,
    mediaMetadata: {
      creationTime: item.createTime,
      width: item.mediaFile?.mediaFileMetadata?.width?.toString(),
      height: item.mediaFile?.mediaFileMetadata?.height?.toString(),
    },
  })) as PhotoItem[];

  return { photos, nextPageToken: response.data.nextPageToken };
}

/**
 * Options for downloading media from the Google Photos Picker API.
 */
export interface DownloadPickerMediaOptions {
  baseUrl?: string;
  sessionId?: string;
  mediaItemId?: string;
  downloadOriginal?: boolean;
  width?: number;
  height?: number;
  isVideo?: boolean;
  savePath?: string;
  includeBase64?: boolean;
}

/**
 * Result of downloading media from the Google Photos Picker API.
 */
export interface DownloadPickerMediaResult {
  success: boolean;
  mediaItemId?: string;
  filename?: string;
  mimeType: string;
  size: number;
  savedTo?: string;
  base64Data?: string;
}

/**
 * Downloads media bytes for an item selected via the Google Photos Picker API
 * using authenticated OAuth requests.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param options - Download options (baseUrl or sessionId + mediaItemId, sizing, destination).
 * @returns Result object containing metadata, saved path, or base64Data.
 */
export async function downloadPickerMedia(
  oauth2Client: OAuth2Client,
  options: DownloadPickerMediaOptions,
): Promise<DownloadPickerMediaResult> {
  let targetBaseUrl = options.baseUrl;
  let filename: string | undefined;
  let mimeType: string | undefined;
  let mediaItemId = options.mediaItemId;

  if (!targetBaseUrl) {
    if (!options.sessionId || !options.mediaItemId) {
      throw new Error(
        "Either baseUrl or both sessionId and mediaItemId must be provided to download Picker media",
      );
    }

    const searchId = options.mediaItemId;
    // Lookup media item in Picker session with per-page quota accounting
    let pageToken: string | undefined;
    let foundPhoto: PhotoItem | undefined;
    do {
      quotaManager.checkQuota(false);
      const page = await listPickerSessionMediaItems(
        oauth2Client,
        options.sessionId,
        100,
        pageToken,
      );
      quotaManager.recordRequest(false);

      foundPhoto = page.photos.find(
        (p) => p.id === searchId || p.id.endsWith(searchId),
      );
      if (foundPhoto) break;
      pageToken = page.nextPageToken;
    } while (pageToken);

    if (!foundPhoto || !foundPhoto.baseUrl) {
      throw new Error(
        `Media item ${options.mediaItemId} not found in Picker session ${options.sessionId}`,
      );
    }

    targetBaseUrl = foundPhoto.baseUrl;
    filename = foundPhoto.filename;
    mimeType = foundPhoto.mimeType;
    mediaItemId = foundPhoto.id;
  }

  // Restrict downloads to official HTTPS Google Photos media domains
  if (!isAllowedGooglePhotosMediaUrl(targetBaseUrl)) {
    throw new Error(
      `Invalid or untrusted baseUrl: must be an HTTPS URL on an official Google Photos media domain (*.googleusercontent.com, *.photos.google.com, photoslibrary.googleapis.com). Received: ${targetBaseUrl}`,
    );
  }

  // Infer video downloads from MIME type, filename, or explicit options.isVideo
  const isVideo =
    options.isVideo !== undefined
      ? options.isVideo
      : Boolean(mimeType?.toLowerCase().startsWith("video/")) ||
        Boolean(
          filename
            ?.toLowerCase()
            .match(/\.(mp4|mov|avi|wmv|mkv|webm|m4v|3gp|flv)$/),
        );

  let downloadUrl = targetBaseUrl;
  if (isVideo) {
    if (!downloadUrl.includes("=dv")) {
      downloadUrl = `${downloadUrl}=dv`;
    }
  } else if (options.width !== undefined || options.height !== undefined) {
    // Google Photos requires both maximum width and maximum height (=w{w}-h{h}).
    // If only one is provided, default the other dimension to maintain aspect ratio.
    const w = options.width ?? options.height;
    const h = options.height ?? options.width;
    if (w !== undefined && h !== undefined) {
      downloadUrl = `${downloadUrl}=w${w}-h${h}`;
    }
  } else if (
    options.downloadOriginal !== false &&
    !downloadUrl.endsWith("=d")
  ) {
    downloadUrl = `${downloadUrl}=d`;
  }

  try {
    quotaManager.checkQuota(true);
    const headers = await getAuthorizedHeaders(oauth2Client);
    const response = await withRetry(
      async () =>
        await axios.get<ArrayBuffer>(downloadUrl, {
          headers,
          responseType: "arraybuffer",
          httpsAgent,
          timeout: 30000,
        }),
      { maxRetries: 3, initialDelayMs: 1000 },
      "download picker media",
    );
    quotaManager.recordRequest(true);

    const buffer = Buffer.from(response.data);
    const responseContentType = response.headers?.["content-type"];
    const resolvedMimeType =
      (typeof responseContentType === "string"
        ? responseContentType
        : undefined) ||
      mimeType ||
      (isVideo ? "video/mp4" : "image/jpeg");

    let savedTo: string | undefined;
    if (options.savePath) {
      const resolvedPath = path.resolve(options.savePath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await writeFile(resolvedPath, buffer);
      savedTo = resolvedPath;
    }

    const shouldIncludeBase64 =
      options.includeBase64 ?? (options.savePath ? false : true);
    const base64Data = shouldIncludeBase64
      ? buffer.toString("base64")
      : undefined;

    return {
      success: true,
      mediaItemId,
      filename,
      mimeType: resolvedMimeType,
      size: buffer.length,
      savedTo,
      base64Data,
    };
  } catch (error) {
    const message = toError(error, "download picker media").message;
    logger.error(`Failed to download picker media: ${message}`);
    throw new Error(`Failed to download picker media: ${message}`, {
      cause: error,
    });
  }
}
