import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPhotosByTokens } from '../photos.js';
import type { PhotoItem } from '../photos.js';

function createPhoto(overrides: Partial<PhotoItem>): PhotoItem {
  return {
    id: overrides.id ?? 'photo-id',
    baseUrl: overrides.baseUrl ?? 'https://example.com/photo.jpg',
    mimeType: overrides.mimeType ?? 'image/jpeg',
    filename: overrides.filename ?? 'photo.jpg',
    description: overrides.description,
    productUrl: overrides.productUrl ?? 'https://photos.google.com',
    mediaMetadata:
      overrides.mediaMetadata ??
      ({
        creationTime: '2020-01-01T00:00:00Z',
        width: '1000',
        height: '800',
      } satisfies PhotoItem['mediaMetadata']),
    locationData: overrides.locationData,
  };
}

test('retains photos when at least one token matches metadata', () => {
  const photos = [
    createPhoto({
      id: 'vacation-photo',
      filename: 'Summer Vacation.jpg',
      description: 'Trip to the beach with friends',
    }),
    createPhoto({
      id: 'family-photo',
      filename: 'Family reunion.png',
      description: 'Family reunion 2022',
      mediaMetadata: {
        creationTime: '2022-01-01T00:00:00Z',
        width: '1000',
        height: '800',
      },
    }),
  ];

  const filtered = filterPhotosByTokens(photos, ['vacation', '2023']);

  assert.deepEqual(
    filtered.map((photo) => photo.id),
    ['vacation-photo'],
  );
});

test('retains photos for multi-word queries present in metadata', () => {
  const photos = [
    createPhoto({
      id: 'family-album-cover',
      description: 'Scanning our family album cover for the project',
    }),
    createPhoto({
      id: 'random-shot',
      description: 'City skyline at night',
    }),
  ];

  const filtered = filterPhotosByTokens(photos, ['family', 'album']);

  assert.deepEqual(
    filtered.map((photo) => photo.id),
    ['family-album-cover'],
  );
});

test('falls back to the original list when no tokens match', () => {
  const photos = [
    createPhoto({ id: 'first-photo', description: 'A walk in the park' }),
    createPhoto({ id: 'second-photo', description: 'Evening skyline' }),
  ];

  const filtered = filterPhotosByTokens(photos, ['unmatched']);

  assert.strictEqual(filtered, photos);
});
