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
  mediaItemIds: z
    .array(z.string())
    .min(1, 'At least one media item ID is required')
    .max(50, 'Maximum 50 media item IDs per call'),
});

export const contentCategoryEnum = z.enum([
  'LANDSCAPES', 'RECEIPTS', 'CITYSCAPES', 'LANDMARKS', 'SELFIES', 'PEOPLE',
  'PETS', 'WEDDINGS', 'BIRTHDAYS', 'DOCUMENTS', 'TRAVEL', 'ANIMALS', 'FOOD',
  'SPORT', 'NIGHT', 'PERFORMANCES', 'WHITEBOARDS', 'SCREENSHOTS', 'UTILITY',
  'ARTS', 'CRAFTS', 'FASHION', 'HOUSES', 'GARDENS', 'FLOWERS', 'HOLIDAYS',
]);

const dateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
});

const dateRangeSchema = z.object({
  startDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
  endDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
});

/**
 * Schema for search_media_by_filter tool arguments
 * Structured filter-based search bypassing NLP — maps directly to Google Photos SearchFilter API.
 */
export const searchMediaByFilterSchema = z
  .object({
    dates: z.array(dateSchema).max(5, 'Maximum 5 dates allowed').optional(),
    dateRanges: z.array(dateRangeSchema).max(5, 'Maximum 5 date ranges allowed').optional(),
    includedCategories: z.array(contentCategoryEnum).optional(),
    excludedCategories: z.array(contentCategoryEnum).optional(),
    mediaType: z.enum(['ALL_MEDIA', 'PHOTO', 'VIDEO']).optional(),
    includeFavorites: z.boolean().optional(),
    includeArchived: z.boolean().optional(),
    orderBy: z.enum(['MediaMetadata.creation_time', 'MediaMetadata.creation_time desc']).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    pageToken: z.string().optional(),
  })
  .refine(
    (data) => !(data.dates && data.dateRanges),
    { message: 'dates and dateRanges are mutually exclusive — use one or the other' },
  )
  .refine(
    (data) => !(data.orderBy && !data.dates && !data.dateRanges),
    { message: 'orderBy requires a dateFilter (dates or dateRanges)' },
  );

/**
 * Schema for add_album_enrichment tool arguments
 */
export const addEnrichmentSchema = z
  .object({
    albumId: z.string().min(1, 'Album ID is required'),
    type: z.enum(['TEXT', 'LOCATION']),
    text: z.string().optional(),
    locationName: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    position: z.enum(['FIRST_IN_ALBUM', 'LAST_IN_ALBUM']).default('LAST_IN_ALBUM'),
  })
  .refine(
    (data) => !(data.type === 'TEXT' && !data.text),
    { message: 'text is required when type is TEXT' },
  )
  .refine(
    (data) => !(data.type === 'LOCATION' && !data.locationName),
    { message: 'locationName is required when type is LOCATION' },
  );

/**
 * Schema for set_album_cover tool arguments
 */
export const setCoverPhotoSchema = z.object({
  albumId: z.string().min(1, 'Album ID is required'),
  mediaItemId: z.string().min(1, 'Media item ID is required'),
});

/**
 * Schema for create_album_with_media composite tool arguments
 */
export const createAlbumWithMediaSchema = z.object({
  albumTitle: z.string().min(1).max(500),
  files: z.array(z.object({
    filePath: z.string().min(1),
    mimeType: z.string().min(1),
    fileName: z.string().min(1),
    description: z.string().optional(),
  })).min(1, 'At least one file required').max(50, 'Maximum 50 files per call'),
});

/**
 * Schema for describe_filter_capabilities tool arguments (no args needed)
 */
export const describeFilterCapabilitiesSchema = z.object({}).optional();

/**
 * Schema for poll_picker_session tool arguments
 */
export const pollPickerSessionSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
});

