/**
 * Unit tests for src/api/services/photoSearchService.ts
 * Tests high-level search orchestration with mocked repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the repository layer
vi.mock('../../src/api/repositories/photosRepository.js', () => ({
  searchPhotos: vi.fn(),
}));

vi.mock('../../src/api/client.js', () => ({
  toError: vi.fn((err: unknown, ctx: string) => new Error(`${ctx}: ${err}`)),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  searchPhotosByText,
  searchPhotosByLocation,
} from '../../src/api/services/photoSearchService.js';
import { searchPhotos } from '../../src/api/repositories/photosRepository.js';
import { createMockPhotoItem } from '../helpers/factories.js';
import type { OAuth2Client } from 'google-auth-library';

const mockOAuth2Client = {} as OAuth2Client;

describe('searchPhotosByText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns filtered photos based on text query', async () => {
    const photos = [
      createMockPhotoItem({ id: 'match', filename: 'vacation-beach.jpg', description: 'Beach vacation' }),
      createMockPhotoItem({ id: 'no-match', filename: 'work.jpg', description: 'Office meeting' }),
    ];

    vi.mocked(searchPhotos).mockResolvedValue({
      photos,
      nextPageToken: undefined,
    });

    const result = await searchPhotosByText(mockOAuth2Client, 'vacation', 25);

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe('match');
  });

  it('falls back to all photos when no tokens match after filtering', async () => {
    const photos = [
      createMockPhotoItem({ id: 'a', filename: 'IMG_001.jpg' }),
      createMockPhotoItem({ id: 'b', filename: 'IMG_002.jpg' }),
    ];

    vi.mocked(searchPhotos).mockResolvedValue({ photos, nextPageToken: undefined });

    const result = await searchPhotosByText(mockOAuth2Client, 'nonexistent-xyz-query');

    // filterPhotosByTokens falls back to original array when nothing matches
    expect(result.photos).toHaveLength(2);
  });

  it('auto-enables location for location-related queries', async () => {
    vi.mocked(searchPhotos).mockResolvedValue({ photos: [], nextPageToken: undefined });

    await searchPhotosByText(mockOAuth2Client, 'photos near the beach', 25, undefined, false);

    // The keyword "near" should trigger location enrichment
    expect(searchPhotos).toHaveBeenCalledWith(
      mockOAuth2Client,
      expect.objectContaining({}),
      true, // includeLocation should be true due to "near"
    );
  });

  it('passes pagination parameters correctly', async () => {
    vi.mocked(searchPhotos).mockResolvedValue({
      photos: [],
      nextPageToken: 'token-2',
    });

    const result = await searchPhotosByText(mockOAuth2Client, 'test', 10, 'token-1');

    expect(searchPhotos).toHaveBeenCalledWith(
      mockOAuth2Client,
      expect.objectContaining({
        pageSize: 10,
        pageToken: 'token-1',
      }),
      expect.any(Boolean),
    );
    expect(result.nextPageToken).toBe('token-2');
  });

  it('throws on API failure', async () => {
    vi.mocked(searchPhotos).mockRejectedValue(new Error('API error'));

    await expect(
      searchPhotosByText(mockOAuth2Client, 'test'),
    ).rejects.toThrow('Failed to search photos by text');
  });
});

describe('searchPhotosByLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns photos matching location query', async () => {
    const photos = [
      createMockPhotoItem({
        id: 'paris-photo',
        locationData: { city: 'Paris', countryName: 'France', approximate: false },
      }),
      createMockPhotoItem({
        id: 'tokyo-photo',
        locationData: { city: 'Tokyo', countryName: 'Japan', approximate: false },
      }),
    ];

    vi.mocked(searchPhotos).mockResolvedValue({ photos, nextPageToken: undefined });

    const result = await searchPhotosByLocation(mockOAuth2Client, 'Paris');

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe('paris-photo');
  });

  it('returns empty when no photos match location', async () => {
    const photos = [
      createMockPhotoItem({
        id: 'tokyo-photo',
        locationData: { city: 'Tokyo', approximate: false },
      }),
    ];

    vi.mocked(searchPhotos).mockResolvedValue({ photos, nextPageToken: undefined });

    const result = await searchPhotosByLocation(mockOAuth2Client, 'Amsterdam');

    expect(result.photos).toHaveLength(0);
  });

  it('always requests location enrichment', async () => {
    vi.mocked(searchPhotos).mockResolvedValue({ photos: [], nextPageToken: undefined });

    await searchPhotosByLocation(mockOAuth2Client, 'Berlin');

    expect(searchPhotos).toHaveBeenCalledWith(
      mockOAuth2Client,
      expect.any(Object),
      true, // includeLocation always true for location searches
    );
  });

  it('throws on API failure', async () => {
    vi.mocked(searchPhotos).mockRejectedValue(new Error('API error'));

    await expect(
      searchPhotosByLocation(mockOAuth2Client, 'London'),
    ).rejects.toThrow('Failed to search photos by location');
  });
});
