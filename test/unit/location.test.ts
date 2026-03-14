import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios before importing location module
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Mock nominatimRateLimiter to passthrough
vi.mock('../../src/utils/nominatimRateLimiter.js', () => ({
  nominatimRateLimiter: {
    throttle: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  },
}));

// Mock logger to suppress output
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are registered
import { reverseGeocode, getPhotoLocation } from '../../src/utils/location.js';
import { nominatimRateLimiter } from '../../src/utils/nominatimRateLimiter.js';

const NOMINATIM_PARIS_RESPONSE = {
  data: {
    display_name: 'Eiffel Tower, Paris, Ile-de-France, France',
    name: 'Eiffel Tower',
    address: {
      city: 'Paris',
      state: 'Ile-de-France',
      country: 'France',
    },
  },
};

const NOMINATIM_ERROR_RESPONSE = {
  data: {
    error: 'Unable to geocode',
  },
};

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset throttle to passthrough
    vi.mocked(nominatimRateLimiter.throttle).mockImplementation(<T>(fn: () => Promise<T>) => fn());
  });

  it('returns LocationData with city="Paris" and countryName="France" for Paris coordinates', async () => {
    vi.mocked(mockedAxios.get).mockResolvedValueOnce(NOMINATIM_PARIS_RESPONSE);

    const result = await reverseGeocode(48.8566, 2.3522);

    expect(result).not.toBeNull();
    expect(result?.city).toBe('Paris');
    expect(result?.countryName).toBe('France');
    expect(result?.approximate).toBe(false);
  });

  it('returns null when Nominatim response contains { error: "Unable to geocode" }', async () => {
    vi.mocked(mockedAxios.get).mockResolvedValueOnce(NOMINATIM_ERROR_RESPONSE);

    const result = await reverseGeocode(0, 0);

    expect(result).toBeNull();
  });

  it('returns null and does not throw when axios throws a network error', async () => {
    vi.mocked(mockedAxios.get).mockRejectedValueOnce(new Error('Network Error'));

    const result = await reverseGeocode(48.8566, 2.3522);

    expect(result).toBeNull();
  });

  it('calls nominatimRateLimiter.throttle exactly once', async () => {
    vi.mocked(mockedAxios.get).mockResolvedValueOnce(NOMINATIM_PARIS_RESPONSE);

    await reverseGeocode(48.8566, 2.3522);

    expect(nominatimRateLimiter.throttle).toHaveBeenCalledTimes(1);
  });

  it('sends the correct User-Agent header to Nominatim /reverse endpoint', async () => {
    vi.mocked(mockedAxios.get).mockResolvedValueOnce(NOMINATIM_PARIS_RESPONSE);

    await reverseGeocode(48.8566, 2.3522);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://nominatim.openstreetmap.org/reverse',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'Google-Photos-MCP-Server/1.0',
        }),
      })
    );
  });
});

describe('getPhotoLocation reverse-geocoding wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nominatimRateLimiter.throttle).mockImplementation(<T>(fn: () => Promise<T>) => fn());
  });

  it('calls reverseGeocode to enrich a photo with coords but no locationName when performGeocoding=true', async () => {
    // Photo that has locationData with coordinates but no human-readable name.
    // extractLocationFromPhoto reads from description using "Location: name, city, country" pattern.
    // We provide description with coord-style "Location: , , " that yields no locationName/city/country
    // and then set locationData directly on the photo object — but extractLocationFromPhoto ignores locationData.
    // Instead, use a description that contains coords in a custom prefix so extractLocationFromPhoto
    // returns null, then we rely on photo.locationData being available to getPhotoLocation.
    //
    // Since extractLocationFromPhoto returns null for photos without the Location: pattern,
    // we need getPhotoLocation to have a way to pick up raw coords. The test verifies that
    // when a photo has locationData.latitude/longitude but no locationData.locationName/city/country,
    // reverseGeocode is called.
    //
    // To make this testable without modifying extractLocationFromPhoto, we test with a photo
    // whose description encodes a Location pattern that gives coords. Since the Location pattern
    // extracts [name, city, country] not coords, the only way to inject raw coords is via photo.locationData.
    // getPhotoLocation must be extended to check photo.locationData as a fallback (part of Task 3 wiring).
    //
    // We construct a photo object where photo.locationData has lat/lng with no name.
    const photo = {
      id: 'photo-with-coords',
      description: undefined,
      mediaMetadata: undefined,
      locationData: {
        latitude: 48.8566,
        longitude: 2.3522,
        approximate: true,
      },
    };

    vi.mocked(mockedAxios.get).mockResolvedValueOnce(NOMINATIM_PARIS_RESPONSE);

    const result = await getPhotoLocation(photo, true);

    // reverseGeocode should have been called (axios.get is the signal)
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://nominatim.openstreetmap.org/reverse',
      expect.anything()
    );
    expect(result).not.toBeNull();
    expect(result?.city).toBe('Paris');
    expect(result?.countryName).toBe('France');
  });

  it('does NOT call reverseGeocode when performGeocoding=false even if photo has coords without name', async () => {
    const photo = {
      id: 'photo-with-coords',
      description: undefined,
      mediaMetadata: undefined,
      locationData: {
        latitude: 48.8566,
        longitude: 2.3522,
        approximate: true,
      },
    };

    const _result = await getPhotoLocation(photo, false);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    // result may be null (no description to extract from) or contain raw locationData
    // The key assertion: no geocoding call was made
  });
});
