import { SearchFilter } from '../types.js';

/**
 * Builds search filters from natural language queries
 */

/**
 * Builds a SearchFilter object from a natural language query string.
 * Detects dates, categories, media types, and features.
 *
 * @param query - The search query string.
 * @returns A SearchFilter object.
 */
export function buildFiltersFromQuery(query: string): SearchFilter {
  const filters: SearchFilter = {};
  const categoriesMap: Record<string, string> = {
    landscapes: 'LANDSCAPES',
    selfie: 'SELFIES',
    selfies: 'SELFIES',
    portrait: 'PORTRAITS',
    portraits: 'PORTRAITS',
    animal: 'ANIMALS',
    animals: 'ANIMALS',
    pet: 'PETS',
    pets: 'PETS',
    flower: 'FLOWERS',
    flowers: 'FLOWERS',
    food: 'FOOD',
    travel: 'TRAVEL',
    city: 'CITYSCAPES',
    cityscape: 'CITYSCAPES',
    landmark: 'LANDMARKS',
    document: 'DOCUMENTS',
    documents: 'DOCUMENTS',
    screenshot: 'SCREENSHOTS',
    screenshots: 'SCREENSHOTS',
    utility: 'UTILITY',
  };

  const includedCategories = new Set<string>();
  const lowerQuery = query.toLowerCase();
  Object.entries(categoriesMap).forEach(([term, category]) => {
    if (lowerQuery.includes(term)) {
      includedCategories.add(category);
    }
  });

  if (includedCategories.size > 0) {
    filters.contentFilter = {
      includedContentCategories: Array.from(includedCategories),
    };
  }

  // Date parsing
  const yearRegex = /\b(20\d{2})\b/g;
  const yearMonthRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/g;
  const dateRegex = /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])\b/g;

  const dates: Array<{ year: number; month?: number; day?: number }> = [];
  const fullDateMatches = [...query.matchAll(dateRegex)];
  if (fullDateMatches.length > 0) {
    for (const match of fullDateMatches) {
      dates.push({
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
      });
    }
  } else {
    const yearMonthMatches = [...query.matchAll(yearMonthRegex)];
    if (yearMonthMatches.length > 0) {
      for (const match of yearMonthMatches) {
        dates.push({
          year: parseInt(match[1], 10),
          month: parseInt(match[2], 10),
        });
      }
    } else {
      const yearMatches = [...query.matchAll(yearRegex)];
      if (yearMatches.length > 0) {
        for (const match of yearMatches) {
          dates.push({
            year: parseInt(match[1], 10),
          });
        }
      }
    }
  }

  if (dates.length > 0) {
    filters.dateFilter = { dates };
  }

  // Media type parsing
  const mediaTypes = new Set<'ALL_MEDIA' | 'VIDEO' | 'PHOTO'>();
  if (lowerQuery.includes('video')) {
    mediaTypes.add('VIDEO');
  }
  if (lowerQuery.includes('photo') || lowerQuery.includes('image')) {
    mediaTypes.add('PHOTO');
  }

  if (mediaTypes.size > 0) {
    filters.mediaTypeFilter = { mediaTypes: Array.from(mediaTypes) };
  }

  // Feature parsing
  const includedFeatures: string[] = [];
  if (lowerQuery.includes('favorite')) {
    includedFeatures.push('FAVORITES');
  }
  if (includedFeatures.length > 0) {
    filters.featureFilter = { includedFeatures };
  }

  // Default to ALL_MEDIA if no filters specified
  if (
    !filters.contentFilter &&
    !filters.dateFilter &&
    !filters.mediaTypeFilter &&
    !filters.featureFilter
  ) {
    filters.mediaTypeFilter = { mediaTypes: ['ALL_MEDIA'] };
  }

  return filters;
}
