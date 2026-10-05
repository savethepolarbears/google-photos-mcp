import { OAuth2Client } from "google-auth-library";
import axios from "axios";
import { readFile } from "fs/promises";
import fs, { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
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
import childProcess from "child_process";
import {
  enforceWindowsOwnerOnlyAcl,
  parseWindowsNonOwnerAces,
} from "../../auth/tokens.js";
import { withRetry } from "../../utils/retry.js";
import logger from "../../utils/logger.js";
import { quotaManager } from "../../utils/quotaManager.js";

/**
 * Preserves permissions from a pre-existing destination file to a newly written temporary file
 * before atomic replacement via rename.
 *
 * On Unix, copies exact mode bits (e.g. 0600).
 * On Windows, synchronizes mode bits and preserves owner-only ACLs if the destination had restricted ACLs.
 * Fails closed by throwing if permissions or ACLs cannot be preserved on an existing destination file.
 *
 * @param existingPath - The original destination file path.
 * @param tempPath - The temporary file that will replace the destination.
 */
export function preserveDestinationPermissions(
  existingPath: string,
  tempPath: string,
): void {
  if (!fs.existsSync(existingPath)) {
    return;
  }

  const existingStats = fs.statSync(existingPath);

  if (process.platform === "win32") {
    try {
      fs.chmodSync(tempPath, existingStats.mode & 0o777);
    } catch (err) {
      const msg = `Could not synchronize file mode on Windows from ${existingPath} to ${tempPath}: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      throw new Error(msg, { cause: err });
    }

    const username = process.env.USERNAME || process.env.USER;
    if (!username) {
      throw new Error(
        `Could not determine Windows username to verify and preserve destination ACL from ${existingPath}`,
      );
    }

    try {
      const output = childProcess.execFileSync("icacls.exe", [existingPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const isInheritanceDisabled =
        output.includes("(I)") === false && output.includes(":");
      const nonOwnerAces = parseWindowsNonOwnerAces(
        output,
        username,
        existingPath,
      );
      if (isInheritanceDisabled || nonOwnerAces.length === 0) {
        enforceWindowsOwnerOnlyAcl(tempPath);
      }
    } catch (err) {
      const msg = `Could not verify or preserve Windows ACL from ${existingPath} to ${tempPath}: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      throw new Error(msg, { cause: err });
    }
    return;
  }

  // Unix / macOS: copy exact file mode bits (e.g. 0600)
  const existingMode = existingStats.mode & 0o777;
  try {
    fs.chmodSync(tempPath, existingMode);
  } catch (err) {
    const msg = `Could not enforce mode 0${existingMode.toString(8)} on temporary file ${tempPath}: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    throw new Error(msg, { cause: err });
  }
}

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
    async () => {
      quotaManager.checkQuota(false);
      quotaManager.recordRequest(false);
      return await client.sessions.create(options);
    },
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
    async () => {
      quotaManager.checkQuota(false);
      quotaManager.recordRequest(false);
      return await client.sessions.get(sessionId);
    },
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
    async () => {
      quotaManager.checkQuota(false);
      quotaManager.recordRequest(false);
      return await client.sessions.delete(sessionId);
    },
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
      videoMetadata?: {
        fps?: number;
        processingStatus?:
          | "UNSPECIFIED"
          | "PROCESSING"
          | "READY"
          | "FAILED"
          | string;
      };
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
    async () => {
      quotaManager.checkQuota(false);
      quotaManager.recordRequest(false);
      return await client.sessions.listMediaItems(sessionId, {
        pageSize,
        pageToken,
      });
    },
    { maxRetries: 3, initialDelayMs: 1000 },
    "list picker media",
  );

  const items = (response.data.mediaItems || []) as PickerMediaItem[];

  const photos = items.map((item) => {
    const videoMetadata = item.mediaFile?.mediaFileMetadata?.videoMetadata;
    const processingStatus = videoMetadata?.processingStatus;
    const photo: PhotoItem = {
      id: item.id ?? item.mediaFile?.mediaFileId ?? "",
      filename: item.mediaFile?.filename ?? "",
      baseUrl: item.mediaFile?.baseUrl ?? "",
      productUrl: item.mediaFile?.baseUrl ?? "",
      mimeType: item.mediaFile?.mimeType,
      processingStatus,
      mediaMetadata: {
        creationTime: item.createTime,
        width: item.mediaFile?.mediaFileMetadata?.width?.toString(),
        height: item.mediaFile?.mediaFileMetadata?.height?.toString(),
        video: videoMetadata
          ? {
              status: processingStatus,
              fps: videoMetadata.fps,
            }
          : undefined,
      },
    };
    return photo;
  });

  return { photos, nextPageToken: response.data.nextPageToken };
}

/**
 * Options for downloading media from the Google Photos Picker API.
 */
export interface DownloadPickerMediaOptions {
  baseUrl?: string;
  sessionId?: string;
  mediaItemId?: string;
  mimeType?: string;
  processingStatus?: string;
  /**
   * Whether to download full-resolution original media (appends '=d' for images).
   * Note: For videos, Google Photos base URLs exclusively return a high-quality
   * transcoded MP4 stream via '=dv'; original unmodified video files cannot be
   * retrieved via baseUrl. If false and dimensions are omitted for images,
   * defaults to '=w2048-h2048'.
   */
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
  /**
   * Indicates whether the returned media bytes are transcoded rather than original.
   * True for videos (downloaded via '=dv'), as Google Photos base URLs exclusively
   * return transcoded MP4 streams rather than original video files.
   */
  isTranscoded?: boolean;
}

/**
 * Downloads media bytes for an item selected via the Google Photos Picker API
 * using authenticated OAuth requests and streaming.
 *
 * @param oauth2Client - The authenticated OAuth2 client.
 * @param options - Download options (baseUrl or sessionId + mediaItemId, sizing, destination).
 * @returns Result object containing metadata, saved path, or base64Data.
 */
export async function downloadPickerMedia(
  oauth2Client: OAuth2Client,
  options: DownloadPickerMediaOptions,
): Promise<DownloadPickerMediaResult> {
  if (options.includeBase64 === false && !options.savePath) {
    throw new Error(
      "savePath must be provided when includeBase64 is false",
    );
  }

  if (
    options.width !== undefined &&
    (options.width < 1 ||
      options.width > 16383 ||
      !Number.isInteger(options.width))
  ) {
    throw new Error("width must be an integer between 1 and 16383");
  }

  if (
    options.height !== undefined &&
    (options.height < 1 ||
      options.height > 16383 ||
      !Number.isInteger(options.height))
  ) {
    throw new Error("height must be an integer between 1 and 16383");
  }

  let targetBaseUrl = options.baseUrl;
  let filename: string | undefined;
  let mimeType: string | undefined = options.mimeType;
  let mediaItemId = options.mediaItemId;
  let itemProcessingStatus = options.processingStatus;
  let sessionResolvedIsVideo: boolean | undefined;

  if (targetBaseUrl) {
    // Restrict downloads to official HTTPS Google Photos media domains immediately
    if (!isAllowedGooglePhotosMediaUrl(targetBaseUrl)) {
      throw new Error(
        `Invalid or untrusted baseUrl: must be an HTTPS URL on an official Google Photos media domain (*.googleusercontent.com, *.photos.google.com, photoslibrary.googleapis.com). Received: ${targetBaseUrl}`,
      );
    }

    if (options.sessionId) {
      // Lookup session to verify item exists and resolve metadata (type, ID, processingStatus)
      let pageToken: string | undefined;
      let foundInSession = false;
      let foundMatchingUrl = false;
      let foundMatchingId = false;

      do {
        const page = await listPickerSessionMediaItems(
          oauth2Client,
          options.sessionId,
          100,
          pageToken,
        );

        for (const p of page.photos) {
          const urlMatches =
            p.baseUrl === targetBaseUrl || p.productUrl === targetBaseUrl;
          const idMatches = Boolean(
            options.mediaItemId && p.id === options.mediaItemId,
          );

          if (urlMatches) foundMatchingUrl = true;
          if (idMatches) foundMatchingId = true;

          // The item must match targetBaseUrl. If mediaItemId was also supplied, it must identify the same item.
          if (urlMatches && (!options.mediaItemId || idMatches)) {
            filename = filename || p.filename;
            if (!mimeType) mimeType = p.mimeType;
            if (!mediaItemId) mediaItemId = p.id;
            // Unconditionally assign fresh processing status from session so absent status clears stale caller input
            itemProcessingStatus = p.processingStatus;
            sessionResolvedIsVideo =
              Boolean(p.mediaMetadata?.video) ||
              Boolean(p.mimeType?.toLowerCase().startsWith("video/")) ||
              Boolean(
                p.filename
                  ?.toLowerCase()
                  .match(/\.(mp4|mov|avi|wmv|mkv|webm|m4v|3gp|flv)$/),
              );
            foundInSession = true;
            break;
          }
        }

        if (foundInSession) break;
        pageToken = page.nextPageToken;
      } while (pageToken);

      if (!foundInSession) {
        if (options.mediaItemId && (foundMatchingUrl || foundMatchingId)) {
          throw new Error(
            `The provided baseUrl and mediaItemId (${options.mediaItemId}) refer to different items in Picker session ${options.sessionId}. Both must identify the same item.`,
          );
        }
        throw new Error(
          `Could not find matching media item for baseUrl in Picker session ${options.sessionId}. Please provide isVideo or mimeType to specify the media type directly.`,
        );
      }
    } else if (
      options.isVideo === undefined &&
      !mimeType
    ) {
      throw new Error(
        "When specifying baseUrl without sessionId, either isVideo or mimeType must be provided to determine the correct download parameters (=d or =dv)",
      );
    }
  } else {
    if (!options.sessionId || !options.mediaItemId) {
      throw new Error(
        "Either baseUrl or both sessionId and mediaItemId must be provided to download Picker media",
      );
    }

    const searchId = options.mediaItemId;
    // Lookup media item in Picker session with per-attempt quota accounting in listPickerSessionMediaItems
    let pageToken: string | undefined;
    let foundPhoto: PhotoItem | undefined;
    do {
      const page = await listPickerSessionMediaItems(
        oauth2Client,
        options.sessionId,
        100,
        pageToken,
      );

      foundPhoto = page.photos.find((p) => p.id === searchId);
      if (foundPhoto) break;
      pageToken = page.nextPageToken;
    } while (pageToken);

    if (!foundPhoto || !foundPhoto.baseUrl) {
      throw new Error(
        `Media item ${options.mediaItemId} not found in Picker session ${options.sessionId}`,
      );
    }

    targetBaseUrl = foundPhoto.baseUrl;
    filename = filename || foundPhoto.filename;
    mimeType = mimeType || foundPhoto.mimeType;
    mediaItemId = foundPhoto.id;
    // Unconditionally assign fresh processing status from session so absent status clears stale caller input
    itemProcessingStatus = foundPhoto.processingStatus;
    sessionResolvedIsVideo =
      Boolean(foundPhoto.mediaMetadata?.video) ||
      Boolean(foundPhoto.mimeType?.toLowerCase().startsWith("video/")) ||
      Boolean(
        foundPhoto.filename
          ?.toLowerCase()
          .match(/\.(mp4|mov|avi|wmv|mkv|webm|m4v|3gp|flv)$/),
      );

    if (!isAllowedGooglePhotosMediaUrl(targetBaseUrl)) {
      throw new Error(
        `Invalid or untrusted baseUrl: must be an HTTPS URL on an official Google Photos media domain (*.googleusercontent.com, *.photos.google.com, photoslibrary.googleapis.com). Received: ${targetBaseUrl}`,
      );
    }
  }

  // Infer video downloads: for calls that resolve an item from sessionId, derive the media
  // type authoritatively from the matched session item. Reserve caller override (options.isVideo)
  // for the baseUrl-only form.
  const isVideo =
    sessionResolvedIsVideo !== undefined
      ? sessionResolvedIsVideo
      : options.isVideo !== undefined
        ? options.isVideo
        : Boolean(mimeType?.toLowerCase().startsWith("video/")) ||
          Boolean(
            filename
              ?.toLowerCase()
              .match(/\.(mp4|mov|avi|wmv|mkv|webm|m4v|3gp|flv)$/),
          );

  let downloadUrl = targetBaseUrl;
  if (isVideo) {
    if (itemProcessingStatus === "PROCESSING") {
      throw new Error(
        `Video ${mediaItemId || filename || "item"} is currently being processed by Google Photos (processingStatus: "PROCESSING"). Video bytes can only be requested once processing status is READY. Please poll the session again later before downloading.`,
      );
    }
    if (itemProcessingStatus === "FAILED") {
      throw new Error(
        `Video ${mediaItemId || filename || "item"} failed processing in Google Photos (processingStatus: "FAILED"). Video bytes cannot be retrieved.`,
      );
    }
    if (itemProcessingStatus !== "READY") {
      const guidance = options.sessionId
        ? "Please poll the session until status is READY before downloading bytes."
        : 'Please poll the session until status is READY, or pass processingStatus: "READY" if status has already been verified.';
      throw new Error(
        `Video ${mediaItemId || filename || "item"} cannot be downloaded: video processingStatus is ${itemProcessingStatus ? `"${itemProcessingStatus}"` : "not specified (unknown)"}. Google Photos requires video processingStatus to be explicitly READY before downloading video bytes (=dv). ${guidance}`,
      );
    }
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
  } else if (options.downloadOriginal === false) {
    // When original download is disabled without dimensions, default to standard full HD bounding box
    downloadUrl = `${downloadUrl}=w2048-h2048`;
  } else if (!downloadUrl.endsWith("=d")) {
    downloadUrl = `${downloadUrl}=d`;
  }

  const MAX_BASE64_BYTES = 10 * 1024 * 1024; // 10MB limit for in-memory base64 responses

  try {
    const headers = await getAuthorizedHeaders(oauth2Client);
    const response = await withRetry(
      async () => {
        quotaManager.checkQuota(true);
        quotaManager.recordRequest(true);
        return await axios.get<Readable>(downloadUrl, {
          headers,
          responseType: "stream",
          httpsAgent,
          timeout: 60000,
        });
      },
      { maxRetries: 3, initialDelayMs: 1000 },
      "download picker media",
    );

    const stream = response.data as unknown as Readable;
    const responseContentType = response.headers?.["content-type"];
    const resolvedMimeType =
      (typeof responseContentType === "string"
        ? responseContentType
        : undefined) ||
      mimeType ||
      (isVideo ? "video/mp4" : "image/jpeg");

    let savedTo: string | undefined;
    let size = 0;
    let base64Data: string | undefined;

    if (options.savePath) {
      const resolvedPath = path.resolve(options.savePath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Capture pre-existing destination stats to preserve restrictive permissions or ACLs
      const existingStats = fs.existsSync(resolvedPath)
        ? fs.statSync(resolvedPath)
        : null;

      // Stream to a sibling temporary file to preserve any pre-existing destination
      // file if the stream or network aborts mid-transfer.
      const tempPath = path.join(
        dir,
        `.tmp.${path.basename(resolvedPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
      );

      try {
        // Pre-create the temporary file and apply destination permissions/ACL
        // before streaming any media bytes to disk, preventing exposure in shared directories.
        fs.closeSync(
          fs.openSync(
            tempPath,
            "w",
            existingStats ? existingStats.mode & 0o777 : 0o600,
          ),
        );
        preserveDestinationPermissions(resolvedPath, tempPath);

        const fileWriteStream = createWriteStream(tempPath, { flags: "r+" });
        await pipeline(
          stream as unknown as NodeJS.ReadableStream,
          fileWriteStream,
        );
        fs.renameSync(tempPath, resolvedPath);
      } catch (streamErr) {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // best-effort cleanup
          }
        }
        throw streamErr;
      }

      savedTo = resolvedPath;
      size = fs.statSync(resolvedPath).size;

      if (options.includeBase64 === true) {
        if (size > MAX_BASE64_BYTES) {
          throw new Error(
            `Media size (${size} bytes) exceeds maximum allowable base64 limit of 10MB. File was successfully saved to ${resolvedPath}.`,
          );
        }
        const fileBuffer = await readFile(resolvedPath);
        base64Data = fileBuffer.toString("base64");
      }
    } else {
      // Direct in-memory path: honor includeBase64 (defaults to true when savePath is omitted)
      const shouldIncludeBase64 = options.includeBase64 !== false;
      const contentLengthHeader = response.headers?.["content-length"];
      const declaredLength = contentLengthHeader
        ? parseInt(String(contentLengthHeader), 10)
        : undefined;

      if (
        shouldIncludeBase64 &&
        declaredLength &&
        declaredLength > MAX_BASE64_BYTES
      ) {
        if (typeof stream.destroy === "function") {
          stream.destroy();
        }
        throw new Error(
          `Media item size (${declaredLength} bytes) exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.`,
        );
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (shouldIncludeBase64) {
          if (totalBytes > MAX_BASE64_BYTES) {
            if (typeof stream.destroy === "function") {
              stream.destroy();
            }
            throw new Error(
              `Media item size exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.`,
            );
          }
          chunks.push(buf);
        }
      }

      size = totalBytes;
      if (shouldIncludeBase64) {
        const buffer = Buffer.concat(chunks);
        base64Data = buffer.toString("base64");
      }
    }

    return {
      success: true,
      mediaItemId,
      filename,
      mimeType: resolvedMimeType,
      size,
      savedTo,
      base64Data,
      ...(isVideo ? { isTranscoded: true } : {}),
    };
  } catch (error) {
    const message = toError(error, "download picker media").message;
    logger.error(`Failed to download picker media: ${message}`);
    throw new Error(`Failed to download picker media: ${message}`, {
      cause: error,
    });
  }
}
