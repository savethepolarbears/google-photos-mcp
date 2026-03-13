/**
 * Unit tests for src/schemas/toolSchemas.ts
 * Tests all 6 Zod schemas used for MCP tool input validation.
 */

import { describe, it, expect } from 'vitest';
import {
  searchPhotosSchema,
  searchPhotosByLocationSchema,
  getPhotoSchema,
  listAlbumsSchema,
  getAlbumSchema,
  listAlbumPhotosSchema,
} from '../../src/schemas/toolSchemas.js';

describe('searchPhotosSchema', () => {
  it('accepts valid input with all fields', () => {
    const result = searchPhotosSchema.parse({
      query: 'cats',
      pageSize: 10,
      pageToken: 'abc',
      includeLocation: true,
    });
    expect(result.query).toBe('cats');
    expect(result.pageSize).toBe(10);
  });

  it('accepts minimal input with only query', () => {
    const result = searchPhotosSchema.parse({ query: 'dogs' });
    expect(result.query).toBe('dogs');
    expect(result.pageSize).toBeUndefined();
  });

  it('rejects empty query', () => {
    expect(() => searchPhotosSchema.parse({ query: '' })).toThrow();
  });

  it('rejects query longer than 500 chars', () => {
    expect(() => searchPhotosSchema.parse({ query: 'a'.repeat(501) })).toThrow();
  });

  it('rejects pageSize of 0', () => {
    expect(() => searchPhotosSchema.parse({ query: 'test', pageSize: 0 })).toThrow();
  });

  it('rejects pageSize over 100', () => {
    expect(() => searchPhotosSchema.parse({ query: 'test', pageSize: 101 })).toThrow();
  });

  it('rejects non-integer pageSize', () => {
    expect(() => searchPhotosSchema.parse({ query: 'test', pageSize: 2.5 })).toThrow();
  });
});

describe('searchPhotosByLocationSchema', () => {
  it('accepts valid locationName', () => {
    const result = searchPhotosByLocationSchema.parse({ locationName: 'Paris' });
    expect(result.locationName).toBe('Paris');
  });

  it('rejects empty locationName', () => {
    expect(() => searchPhotosByLocationSchema.parse({ locationName: '' })).toThrow();
  });

  it('rejects locationName longer than 200 chars', () => {
    expect(() =>
      searchPhotosByLocationSchema.parse({ locationName: 'a'.repeat(201) }),
    ).toThrow();
  });
});

describe('getPhotoSchema', () => {
  it('accepts valid photoId', () => {
    const result = getPhotoSchema.parse({ photoId: 'abc123' });
    expect(result.photoId).toBe('abc123');
  });

  it('accepts optional includeBase64 and includeLocation', () => {
    const result = getPhotoSchema.parse({
      photoId: 'abc',
      includeBase64: true,
      includeLocation: false,
    });
    expect(result.includeBase64).toBe(true);
    expect(result.includeLocation).toBe(false);
  });

  it('rejects empty photoId', () => {
    expect(() => getPhotoSchema.parse({ photoId: '' })).toThrow();
  });

  it('rejects missing photoId', () => {
    expect(() => getPhotoSchema.parse({})).toThrow();
  });
});

describe('listAlbumsSchema', () => {
  it('accepts empty object', () => {
    const result = listAlbumsSchema.parse({});
    expect(result.pageSize).toBeUndefined();
  });

  it('accepts valid pageSize and pageToken', () => {
    const result = listAlbumsSchema.parse({ pageSize: 50, pageToken: 'next' });
    expect(result.pageSize).toBe(50);
    expect(result.pageToken).toBe('next');
  });

  it('rejects pageSize over 100', () => {
    expect(() => listAlbumsSchema.parse({ pageSize: 101 })).toThrow();
  });
});

describe('getAlbumSchema', () => {
  it('accepts valid albumId', () => {
    const result = getAlbumSchema.parse({ albumId: 'album-xyz' });
    expect(result.albumId).toBe('album-xyz');
  });

  it('rejects empty albumId', () => {
    expect(() => getAlbumSchema.parse({ albumId: '' })).toThrow();
  });

  it('rejects missing albumId', () => {
    expect(() => getAlbumSchema.parse({})).toThrow();
  });
});

describe('listAlbumPhotosSchema', () => {
  it('accepts valid input', () => {
    const result = listAlbumPhotosSchema.parse({
      albumId: 'album-1',
      pageSize: 25,
      includeLocation: true,
    });
    expect(result.albumId).toBe('album-1');
  });

  it('rejects empty albumId', () => {
    expect(() => listAlbumPhotosSchema.parse({ albumId: '' })).toThrow();
  });

  it('rejects pageSize over 100', () => {
    expect(() =>
      listAlbumPhotosSchema.parse({ albumId: 'album-1', pageSize: 101 }),
    ).toThrow();
  });
});
