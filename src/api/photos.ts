/**
 * Google Photos API - Facade Module
 *
 * This module re-exports all Google Photos API functionality from focused sub-modules.
 * Maintains backward compatibility with existing imports while providing better code organization.
 *
 * Module Structure:
 * - types.ts: Type definitions and interfaces
 * - oauth.ts: OAuth2 client management
 * - client.ts: HTTP client wrapper
 * - search/tokenMatcher.ts: Search token logic
 * - search/filterBuilder.ts: Filter construction
 * - enrichment/locationEnricher.ts: Location enrichment
 * - repositories/albumsRepository.ts: Album CRUD operations
 * - repositories/photosRepository.ts: Photo CRUD operations
 * - services/photoSearchService.ts: High-level orchestration
 */

// Type exports (only those consumed by importers)
export type { PhotoItem } from "./types.js";

// OAuth exports
export { createOAuthClient, setupOAuthClient } from "./oauth.js";

// Search exports
export {
  buildSearchTokens,
  matchesSearchTokens,
  filterPhotosByTokens,
} from "./search/tokenMatcher.js";

// Repository exports (Albums)
export {
  listAlbums,
  getAlbum,
  createAlbum,
  batchAddMediaItemsToAlbum,
  addEnrichment,
  patchAlbum,
} from "./repositories/albumsRepository.js";

// Repository exports (Photos)
export {
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
  listMediaItems,
  uploadMedia,
  createPickerSession,
  getPickerSession,
  listPickerSessionMediaItems,
} from "./repositories/photosRepository.js";

// Service exports (High-level)
export {
  searchPhotosByText,
  searchPhotosByLocation,
} from "./services/photoSearchService.js";
