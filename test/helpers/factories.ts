/**
 * Shared factory functions for creating test data.
 * All factories return valid defaults that can be overridden via partial objects.
 */

import type { PhotoItem, Album } from "../../src/api/types.js";
import type { TokenData } from "../../src/auth/tokens.js";

/**
 * Creates a mock PhotoItem with sensible defaults.
 */
export function createMockPhotoItem(
  overrides: Partial<PhotoItem> = {},
): PhotoItem {
  return {
    id: overrides.id ?? "photo-1",
    filename: overrides.filename ?? "IMG_0001.jpg",
    mimeType: overrides.mimeType ?? "image/jpeg",
    description: overrides.description ?? "A test photo",
    baseUrl:
      overrides.baseUrl ?? "https://lh3.googleusercontent.com/test-photo-1",
    productUrl:
      overrides.productUrl ?? "https://photos.google.com/lr/photo/photo-1",
    mediaMetadata: overrides.mediaMetadata ?? {
      creationTime: "2024-06-15T10:30:00Z",
      width: "4032",
      height: "3024",
    },
    locationData: overrides.locationData,
  };
}

/**
 * Creates a mock Album with sensible defaults.
 */
export function createMockAlbum(overrides: Partial<Album> = {}): Album {
  return {
    id: overrides.id ?? "album-1",
    title: overrides.title ?? "Summer Vacation 2024",
    productUrl:
      overrides.productUrl ?? "https://photos.google.com/lr/album/album-1",
    mediaItemsCount: overrides.mediaItemsCount ?? "42",
    coverPhotoBaseUrl:
      overrides.coverPhotoBaseUrl ??
      "https://lh3.googleusercontent.com/cover-1",
  };
}

/**
 * Creates mock TokenData with sensible defaults.
 */
export function createMockTokenData(
  overrides: Partial<TokenData> = {},
): TokenData {
  return {
    access_token: overrides.access_token ?? "ya29.mock-access-token-12345",
    refresh_token: overrides.refresh_token ?? "1//mock-refresh-token-67890",
    expiry_date: overrides.expiry_date ?? Date.now() + 3600000, // 1 hour from now
    userEmail: overrides.userEmail ?? "test@gmail.com",
    userId: overrides.userId ?? "user-123",
    retrievedAt: overrides.retrievedAt ?? Date.now(),
  };
}

/**
 * Creates a minimal CallToolRequest-like object for testing handlers.
 */
export function createMockCallToolRequest(
  toolName: string,
  args: Record<string, unknown> = {},
) {
  return {
    method: "tools/call" as const,
    params: {
      name: toolName,
      arguments: args,
    },
  };
}
