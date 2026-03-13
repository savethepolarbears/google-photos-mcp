/**
 * Unit tests for src/api/repositories/albumsRepository.ts
 * Tests album CRUD operations with mocked API client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../src/api/client.js', () => ({
  getPhotoClient: vi.fn(),
  toError: vi.fn((err: unknown, ctx: string) => new Error(`${ctx}: ${err}`)),
}));

vi.mock('../../src/utils/retry.js', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { listAlbums, getAlbum } from '../../src/api/repositories/albumsRepository.js';
import { getPhotoClient } from '../../src/api/client.js';
import type { OAuth2Client } from 'google-auth-library';

const mockOAuth2Client = {} as OAuth2Client;

describe('listAlbums', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns albums array with pagination token', async () => {
    const mockClient = {
      albums: {
        list: vi.fn().mockResolvedValue({
          data: {
            albums: [
              { id: 'a1', title: 'Vacation', productUrl: 'https://photos.google.com/a1' },
              { id: 'a2', title: 'Family', productUrl: 'https://photos.google.com/a2' },
            ],
            nextPageToken: 'next-page',
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    const result = await listAlbums(mockOAuth2Client, 50);

    expect(result.albums).toHaveLength(2);
    expect(result.albums[0].title).toBe('Vacation');
    expect(result.nextPageToken).toBe('next-page');
  });

  it('returns empty array when no albums exist', async () => {
    const mockClient = {
      albums: {
        list: vi.fn().mockResolvedValue({ data: {} }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    const result = await listAlbums(mockOAuth2Client);

    expect(result.albums).toEqual([]);
    expect(result.nextPageToken).toBeUndefined();
  });

  it('throws descriptive error on API failure', async () => {
    const mockClient = {
      albums: {
        list: vi.fn().mockRejectedValue(new Error('API failure')),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    await expect(listAlbums(mockOAuth2Client)).rejects.toThrow('Failed to list albums');
  });
});

describe('getAlbum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a single album by ID', async () => {
    const mockClient = {
      albums: {
        get: vi.fn().mockResolvedValue({
          data: { id: 'a1', title: 'My Album', productUrl: 'https://photos.google.com/a1' },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    const result = await getAlbum(mockOAuth2Client, 'a1');

    expect(result.id).toBe('a1');
    expect(result.title).toBe('My Album');
  });

  it('throws when album not found (null data)', async () => {
    const mockClient = {
      albums: {
        get: vi.fn().mockResolvedValue({ data: null }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    await expect(getAlbum(mockOAuth2Client, 'nonexistent')).rejects.toThrow();
  });

  it('throws descriptive error on API failure', async () => {
    const mockClient = {
      albums: {
        get: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(mockClient as ReturnType<typeof getPhotoClient>);

    await expect(getAlbum(mockOAuth2Client, 'bad-id')).rejects.toThrow('Failed to get album');
  });
});
