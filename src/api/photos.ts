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

// Type exports
export type {
  PhotoItem,
  Album,
  SearchFilter,
  SearchParams,
  AlbumsListResponse,
  MediaItemsSearchResponse,
  MediaItemResponse,
} from './types.js';

// OAuth exports
export {
  createOAuthClient,
  setupOAuthClient,
} from './oauth.js';

// Client exports
export {
  getPhotoClient,
  toError,
} from './client.js';

// Search exports
export {
  buildSearchTokens,
  matchesSearchTokens,
  filterPhotosByTokens,
  matchesLocationQuery,
} from './search/tokenMatcher.js';

export {
  buildFiltersFromQuery,
} from './search/filterBuilder.js';

// Enrichment exports
export {
  enrichPhotosWithLocation,
} from './enrichment/locationEnricher.js';

// Repository exports (Albums)
export {
  listAlbums,
  getAlbum,
} from './repositories/albumsRepository.js';

// Repository exports (Photos)
export {
  searchPhotos,
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
} from './repositories/photosRepository.js';

// Service exports (High-level)
export {
  searchPhotosByText,
  searchPhotosByLocation,
} from './services/photoSearchService.js';
