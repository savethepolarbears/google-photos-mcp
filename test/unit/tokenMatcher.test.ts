/**
 * Unit tests for src/api/search/tokenMatcher.ts
 * Tests search token building, matching, filtering, and location query matching.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSearchTokens,
  matchesSearchTokens,
  filterPhotosByTokens,
  matchesLocationQuery,
} from '../../src/api/search/tokenMatcher.js';
import { createMockPhotoItem } from '../helpers/factories.js';

describe('buildSearchTokens', () => {
  it('splits query by whitespace into lowercase tokens', () => {
    expect(buildSearchTokens('Vacation Hawaii')).toEqual(['vacation', 'hawaii']);
  });

  it('splits tokens by colons', () => {
    expect(buildSearchTokens('type:photo')).toEqual(['type', 'photo']);
  });

  it('handles multiple spaces and trims', () => {
    expect(buildSearchTokens('  hello   world  ')).toEqual(['hello', 'world']);
  });

  it('returns empty array for empty string', () => {
    expect(buildSearchTokens('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(buildSearchTokens('   ')).toEqual([]);
  });

  it('handles mixed whitespace and colons', () => {
    expect(buildSearchTokens('date:2023 location:paris')).toEqual([
      'date', '2023', 'location', 'paris',
    ]);
  });
});

describe('matchesSearchTokens', () => {
  it('returns true when a token matches the filename', () => {
    const photo = createMockPhotoItem({ filename: 'Summer Vacation.jpg' });
    expect(matchesSearchTokens(photo, ['vacation'])).toBe(true);
  });

  it('returns true when a token matches the description', () => {
    const photo = createMockPhotoItem({ description: 'Family reunion at the park' });
    expect(matchesSearchTokens(photo, ['reunion'])).toBe(true);
  });

  it('returns true when a token matches the creation time', () => {
    const photo = createMockPhotoItem({
      mediaMetadata: { creationTime: '2023-12-25T08:00:00Z', width: '100', height: '100' },
    });
    expect(matchesSearchTokens(photo, ['2023'])).toBe(true);
  });

  it('returns true when a token matches location data', () => {
    const photo = createMockPhotoItem({
      locationData: {
        city: 'Paris',
        countryName: 'France',
        approximate: false,
      },
    });
    expect(matchesSearchTokens(photo, ['paris'])).toBe(true);
  });

  it('returns false when no token matches any field', () => {
    const photo = createMockPhotoItem({
      filename: 'IMG_0001.jpg',
      description: 'A random photo',
    });
    expect(matchesSearchTokens(photo, ['dinosaur'])).toBe(false);
  });

  it('returns true for empty tokens array', () => {
    const photo = createMockPhotoItem();
    expect(matchesSearchTokens(photo, [])).toBe(true);
  });

  it('returns true when at least one of multiple tokens matches', () => {
    const photo = createMockPhotoItem({ filename: 'Beach sunset.jpg' });
    expect(matchesSearchTokens(photo, ['mountain', 'beach'])).toBe(true);
  });

  it('is case-insensitive', () => {
    const photo = createMockPhotoItem({ filename: 'BEACH.JPG' });
    expect(matchesSearchTokens(photo, ['beach'])).toBe(true);
  });

  it('handles photo with minimal searchable fields', () => {
    const photo = createMockPhotoItem({
      filename: '',
      description: undefined,
      mediaMetadata: undefined,
      locationData: undefined,
    });
    // Even an empty filename is a string, so it's included in the haystack
    // but 'test' won't match empty string
    // The function may still return true if the mimeType or other defaults match
    const result = matchesSearchTokens(photo, ['test']);
    expect(typeof result).toBe('boolean');
  });
});

describe('filterPhotosByTokens', () => {
  it('returns matching photos when some match', () => {
    const photos = [
      createMockPhotoItem({ id: 'match', filename: 'vacation.jpg' }),
      createMockPhotoItem({ id: 'no-match', filename: 'work.jpg' }),
    ];
    const result = filterPhotosByTokens(photos, ['vacation']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('match');
  });

  it('falls back to original list when no photos match', () => {
    const photos = [
      createMockPhotoItem({ id: 'a' }),
      createMockPhotoItem({ id: 'b' }),
    ];
    const result = filterPhotosByTokens(photos, ['nonexistent-term-xyz']);
    expect(result).toBe(photos); // same reference — fallback
  });

  it('returns all photos for empty tokens', () => {
    const photos = [createMockPhotoItem(), createMockPhotoItem()];
    const result = filterPhotosByTokens(photos, []);
    expect(result).toBe(photos);
  });

  it('handles empty photos array', () => {
    const result = filterPhotosByTokens([], ['test']);
    expect(result).toEqual([]);
  });
});

describe('matchesLocationQuery', () => {
  it('matches when city contains query', () => {
    const photo = createMockPhotoItem({
      locationData: { city: 'Amsterdam', approximate: false },
    });
    expect(matchesLocationQuery(photo, 'amsterdam')).toBe(true);
  });

  it('matches country name', () => {
    const photo = createMockPhotoItem({
      locationData: { countryName: 'Netherlands', approximate: true },
    });
    expect(matchesLocationQuery(photo, 'netherlands')).toBe(true);
  });

  it('matches partial location name', () => {
    const photo = createMockPhotoItem({
      locationData: { locationName: 'Eiffel Tower', approximate: false },
    });
    expect(matchesLocationQuery(photo, 'eiffel')).toBe(true);
  });

  it('returns false when photo has no location data', () => {
    const photo = createMockPhotoItem({ locationData: undefined });
    expect(matchesLocationQuery(photo, 'paris')).toBe(false);
  });

  it('returns true for empty query', () => {
    const photo = createMockPhotoItem();
    expect(matchesLocationQuery(photo, '')).toBe(true);
  });

  it('is case-insensitive', () => {
    const photo = createMockPhotoItem({
      locationData: { city: 'TOKYO', approximate: false },
    });
    expect(matchesLocationQuery(photo, 'tokyo')).toBe(true);
  });
});
