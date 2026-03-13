/**
 * Unit tests for src/api/search/filterBuilder.ts
 * Tests natural language query → Google Photos API search filter conversion.
 */

import { describe, it, expect } from 'vitest';
import { buildFiltersFromQuery } from '../../src/api/search/filterBuilder.js';

describe('buildFiltersFromQuery', () => {
  describe('category detection', () => {
    it('detects singular category terms', () => {
      const filters = buildFiltersFromQuery('show me a selfie');
      expect(filters.contentFilter?.includedContentCategories).toContain('SELFIES');
    });

    it('detects plural category terms', () => {
      const filters = buildFiltersFromQuery('all my landscapes');
      expect(filters.contentFilter?.includedContentCategories).toContain('LANDSCAPES');
    });

    it('detects multiple categories in one query', () => {
      const filters = buildFiltersFromQuery('food and travel photos');
      expect(filters.contentFilter?.includedContentCategories).toContain('FOOD');
      expect(filters.contentFilter?.includedContentCategories).toContain('TRAVEL');
    });

    it('maps pet and animal correctly', () => {
      const filters = buildFiltersFromQuery('pets and animals');
      expect(filters.contentFilter?.includedContentCategories).toContain('PETS');
      expect(filters.contentFilter?.includedContentCategories).toContain('ANIMALS');
    });

    it('detects screenshots and documents', () => {
      const filters = buildFiltersFromQuery('screenshots or documents');
      expect(filters.contentFilter?.includedContentCategories).toContain('SCREENSHOTS');
      expect(filters.contentFilter?.includedContentCategories).toContain('DOCUMENTS');
    });
  });

  describe('date parsing', () => {
    it('extracts a year from query', () => {
      const filters = buildFiltersFromQuery('photos from 2023');
      expect(filters.dateFilter?.dates).toEqual([{ year: 2023 }]);
    });

    it('extracts year-month from query', () => {
      const filters = buildFiltersFromQuery('photos from 2023-06');
      expect(filters.dateFilter?.dates).toEqual([{ year: 2023, month: 6 }]);
    });

    it('extracts full date from query', () => {
      const filters = buildFiltersFromQuery('photos from 2023-06-15');
      expect(filters.dateFilter?.dates).toEqual([{ year: 2023, month: 6, day: 15 }]);
    });

    it('extracts multiple years', () => {
      const filters = buildFiltersFromQuery('compare 2022 and 2023');
      expect(filters.dateFilter?.dates).toHaveLength(2);
      expect(filters.dateFilter?.dates?.[0].year).toBe(2022);
      expect(filters.dateFilter?.dates?.[1].year).toBe(2023);
    });

    it('handles slash-separated dates', () => {
      const filters = buildFiltersFromQuery('photos from 2023/12/25');
      expect(filters.dateFilter?.dates).toEqual([{ year: 2023, month: 12, day: 25 }]);
    });
  });

  describe('media type detection', () => {
    it('detects video keyword', () => {
      const filters = buildFiltersFromQuery('show me a video');
      expect(filters.mediaTypeFilter?.mediaTypes).toContain('VIDEO');
    });

    it('detects photo keyword', () => {
      const filters = buildFiltersFromQuery('show me a photo');
      expect(filters.mediaTypeFilter?.mediaTypes).toContain('PHOTO');
    });

    it('detects image keyword as photo', () => {
      const filters = buildFiltersFromQuery('an image of a cat');
      expect(filters.mediaTypeFilter?.mediaTypes).toContain('PHOTO');
    });
  });

  describe('feature detection', () => {
    it('detects favorite keyword', () => {
      const filters = buildFiltersFromQuery('my favorite photos');
      expect(filters.featureFilter?.includedFeatures).toContain('FAVORITES');
    });
  });

  describe('default behavior', () => {
    it('defaults to ALL_MEDIA when no keywords match', () => {
      const filters = buildFiltersFromQuery('something random');
      expect(filters.mediaTypeFilter?.mediaTypes).toEqual(['ALL_MEDIA']);
      expect(filters.contentFilter).toBeUndefined();
      expect(filters.dateFilter).toBeUndefined();
      expect(filters.featureFilter).toBeUndefined();
    });
  });

  describe('combined filters', () => {
    it('combines category + date + media type', () => {
      const filters = buildFiltersFromQuery('travel video from 2024');
      expect(filters.contentFilter?.includedContentCategories).toContain('TRAVEL');
      expect(filters.mediaTypeFilter?.mediaTypes).toContain('VIDEO');
      expect(filters.dateFilter?.dates).toEqual([{ year: 2024 }]);
    });

    it('combines category + feature', () => {
      const filters = buildFiltersFromQuery('favorite selfies');
      expect(filters.contentFilter?.includedContentCategories).toContain('SELFIES');
      expect(filters.featureFilter?.includedFeatures).toContain('FAVORITES');
    });
  });
});
