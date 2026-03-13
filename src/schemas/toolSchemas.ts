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

export const createAlbumSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

export const uploadMediaSchema = z.object({
  filePath: z.string().min(1, 'File path is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileName: z.string().min(1, 'File name is required'),
  albumId: z.string().optional(),
  description: z.string().optional(),
});

export const addMediaToAlbumSchema = z.object({
  albumId: z.string().min(1, 'Album ID is required'),
  mediaItemIds: z.array(z.string()).min(1).max(50),
});

