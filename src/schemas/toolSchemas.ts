import { z } from 'zod';

/**
 * Zod schemas for MCP tool input validation.
 * Provides runtime type safety and clear error messages for invalid inputs.
 */

/**
 * Schema for search_photos tool arguments
 */
export const searchPhotosSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(500, 'Query too long'),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  includeLocation: z.boolean().optional(),
});

/**
 * Schema for search_photos_by_location tool arguments
 */
export const searchPhotosByLocationSchema = z.object({
  locationName: z.string().min(1, 'Location name cannot be empty').max(200, 'Location name too long'),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

/**
 * Schema for get_photo tool arguments
 */
export const getPhotoSchema = z.object({
  photoId: z.string().min(1, 'Photo ID is required'),
  includeBase64: z.boolean().optional(),
  includeLocation: z.boolean().optional(),
});

/**
 * Schema for list_albums tool arguments
 */
export const listAlbumsSchema = z.object({
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

/**
 * Schema for get_album tool arguments
 */
export const getAlbumSchema = z.object({
  albumId: z.string().min(1, 'Album ID is required'),
});

/**
 * Schema for list_album_photos tool arguments
 */
export const listAlbumPhotosSchema = z.object({
  albumId: z.string().min(1, 'Album ID is required'),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
  includeLocation: z.boolean().optional(),
});

// Type inference from schemas
export type SearchPhotosArgs = z.infer<typeof searchPhotosSchema>;
export type SearchPhotosByLocationArgs = z.infer<typeof searchPhotosByLocationSchema>;
export type GetPhotoArgs = z.infer<typeof getPhotoSchema>;
export type ListAlbumsArgs = z.infer<typeof listAlbumsSchema>;
export type GetAlbumArgs = z.infer<typeof getAlbumSchema>;
export type ListAlbumPhotosArgs = z.infer<typeof listAlbumPhotosSchema>;
