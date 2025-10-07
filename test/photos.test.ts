import assert from 'node:assert/strict';
import {
  buildSearchTokens,
  filterPhotosByTokens,
  matchesSearchTokens,
  type PhotoItem,
} from '../src/api/photos.js';

function createPhoto(overrides: Partial<PhotoItem> = {}): PhotoItem {
  return {
    id: overrides.id ?? 'photo-1',
    baseUrl: overrides.baseUrl ?? 'https://example.com/photo-1',
    mimeType: overrides.mimeType ?? 'image/jpeg',
    filename: overrides.filename ?? 'IMG_0001.JPG',
    productUrl: overrides.productUrl ?? 'https://photos.google.com/lr/photo/1',
    description: overrides.description,
    mediaMetadata: overrides.mediaMetadata,
    locationData: overrides.locationData,
  };
}

function testMatchesSearchTokensIgnoresUnmatchedTokens() {
  const tokens = buildSearchTokens('vacation 2023');
  assert.deepEqual(tokens, ['vacation', '2023']);

  const photo = createPhoto({ filename: 'Family Vacation in Hawaii.jpg' });

  assert.equal(matchesSearchTokens(photo, tokens), true, 'Photo should match on vacation token');
}

function testFilterPhotosFallsBackWhenNoTokensMatch() {
  const tokens = buildSearchTokens('family album');
  const photos = [createPhoto({ id: 'photo-2', filename: 'IMG_9999.JPG' })];

  const filtered = filterPhotosByTokens(photos, tokens);

  assert.equal(filtered.length, 1, 'Filter should fall back to original results when nothing matches');
  assert.equal(filtered[0].id, 'photo-2');
}

function testMatchesSearchTokensRequiresMatchedSubset() {
  const tokens = buildSearchTokens('family reunion album');
  const photo = createPhoto({ filename: 'Family Reunion Album Cover.jpg' });

  assert.equal(matchesSearchTokens(photo, tokens), true, 'Photo should match when relevant tokens are present');
}

try {
  testMatchesSearchTokensIgnoresUnmatchedTokens();
  testFilterPhotosFallsBackWhenNoTokensMatch();
  testMatchesSearchTokensRequiresMatchedSubset();
  console.log('All photo search tests passed.');
} catch (error) {
  console.error('Test failure:', error);
  process.exitCode = 1;
}
