/**
 * Integration tests for src/mcp/core.ts — GooglePhotosMCPCore
 * Tests the full MCP tool request → response flow with mocked external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('../../src/auth/tokens.js', () => ({
  getFirstAvailableTokens: vi.fn(),
  saveTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/auth/tokenRefreshManager.js', () => ({
  tokenRefreshManager: {
    refreshIfNeeded: vi.fn(async (_client: unknown, _userId: string, tokens: unknown) => tokens),
    getStats: vi.fn().mockReturnValue({ activeRefreshes: 0, userIds: [] }),
  },
}));

vi.mock('../../src/api/photos.js', () => ({
  setupOAuthClient: vi.fn().mockReturnValue({
    setCredentials: vi.fn(),
  }),
  searchPhotosByText: vi.fn().mockResolvedValue({ photos: [], nextPageToken: undefined }),
  searchPhotosByLocation: vi.fn().mockResolvedValue({ photos: [], nextPageToken: undefined }),
  listAlbums: vi.fn().mockResolvedValue({ albums: [], nextPageToken: undefined }),
  listAlbumPhotos: vi.fn().mockResolvedValue({ photos: [], nextPageToken: undefined }),
  getPhoto: vi.fn().mockResolvedValue({
    id: 'p1',
    filename: 'test.jpg',
    baseUrl: 'https://example.com/test',
    productUrl: 'https://photos.google.com/p1',
  }),
  getPhotoAsBase64: vi.fn().mockResolvedValue('base64data'),
  getAlbum: vi.fn().mockResolvedValue({
    id: 'a1',
    title: 'Test Album',
    productUrl: 'https://photos.google.com/a1',
    mediaItemsCount: '5',
  }),
}));

vi.mock('../../src/utils/quotaManager.js', () => ({
  quotaManager: {
    checkQuota: vi.fn(),
    recordRequest: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      requests: { used: 0, max: 10000, remaining: 10000, utilizationPercent: 0 },
      mediaBytes: { used: 0, max: 75000, remaining: 75000, utilizationPercent: 0 },
      resetTime: new Date().toISOString(),
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GooglePhotosMCPCore } from '../../src/mcp/core.js';
import { getFirstAvailableTokens } from '../../src/auth/tokens.js';
import { searchPhotosByText, listAlbums, getPhoto, getPhotoAsBase64 } from '../../src/api/photos.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { createMockCallToolRequest } from '../helpers/factories.js';

describe('GooglePhotosMCPCore', () => {
  let core: GooglePhotosMCPCore;

  beforeEach(() => {
    vi.clearAllMocks();
    core = new GooglePhotosMCPCore({ name: 'test-server', version: '0.0.1' });
  });

  describe('handleListTools', () => {
    it('returns all 7 tool definitions', async () => {
      // Access the protected method via the server's handler
      // We invoke it through the class's internal method
      const result = await (core as unknown as { handleListTools: () => Promise<{ tools: unknown[] }> }).handleListTools();

      expect(result.tools).toHaveLength(7);
      const toolNames = result.tools.map((t: unknown) => (t as { name: string }).name);
      expect(toolNames).toContain('auth_status');
      expect(toolNames).toContain('search_photos');
      expect(toolNames).toContain('search_photos_by_location');
      expect(toolNames).toContain('get_photo');
      expect(toolNames).toContain('list_albums');
      expect(toolNames).toContain('get_album');
      expect(toolNames).toContain('list_album_photos');
    });

    it('each tool has name, description, and inputSchema', async () => {
      const result = await (core as unknown as { handleListTools: () => Promise<{ tools: Array<{ name: string; description: string; inputSchema: object }> }> }).handleListTools();

      for (const tool of result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('handleCallTool', () => {
    const mockTokens = {
      access_token: 'ya29.mock',
      refresh_token: '1//mock',
      expiry_date: Date.now() + 3600000,
      userEmail: 'test@gmail.com',
      userId: 'user-1',
    };

    describe('auth_status', () => {
      it('returns authenticated status when tokens exist', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);

        const request = createMockCallToolRequest('auth_status');
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.authenticated).toBe(true);
        expect(parsed.userEmail).toBe('test@gmail.com');
      });

      it('returns unauthenticated status when no tokens', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(null);

        const request = createMockCallToolRequest('auth_status');
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.authenticated).toBe(false);
        expect(parsed.message).toContain('Not authenticated');
      });
    });

    describe('search_photos', () => {
      it('returns formatted photos for valid query', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);
        vi.mocked(searchPhotosByText).mockResolvedValue({
          photos: [{
            id: 'p1',
            filename: 'beach.jpg',
            baseUrl: 'https://example.com/beach',
            productUrl: 'https://photos.google.com/p1',
            mediaMetadata: { creationTime: '2024-01-01T00:00:00Z', width: '1000', height: '800' },
          }],
          nextPageToken: undefined,
        });

        const request = createMockCallToolRequest('search_photos', { query: 'beach' });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.query).toBe('beach');
        expect(parsed.count).toBe(1);
        expect(parsed.photos[0].filename).toBe('beach.jpg');
      });

      it('returns auth required error when not authenticated', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(null);

        const request = createMockCallToolRequest('search_photos', { query: 'cats' });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe('Authentication required');
      });

      it('throws McpError for invalid arguments', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);

        const request = createMockCallToolRequest('search_photos', { query: '' });

        await expect(
          (core as unknown as { handleCallTool: (req: typeof request) => Promise<unknown> }).handleCallTool(request),
        ).rejects.toThrow(McpError);
      });
    });

    describe('list_albums', () => {
      it('returns formatted album list', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);
        vi.mocked(listAlbums).mockResolvedValue({
          albums: [{
            id: 'a1',
            title: 'Vacation',
            productUrl: 'https://photos.google.com/a1',
            mediaItemsCount: '42',
            coverPhotoBaseUrl: 'https://example.com/cover',
          }],
          nextPageToken: undefined,
        });

        const request = createMockCallToolRequest('list_albums', {});
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.count).toBe(1);
        expect(parsed.albums[0].title).toBe('Vacation');
      });
    });

    describe('get_photo', () => {
      it('returns photo details', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);

        const request = createMockCallToolRequest('get_photo', { photoId: 'p1' });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('p1');
      });

      it('includes base64 when requested', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);
        vi.mocked(getPhoto).mockResolvedValue({
          id: 'p1',
          filename: 'photo.jpg',
          baseUrl: 'https://example.com/photo',
          productUrl: 'https://photos.google.com/p1',
        });

        const request = createMockCallToolRequest('get_photo', {
          photoId: 'p1',
          includeBase64: true,
        });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.base64Image).toBe('base64data');
        expect(getPhotoAsBase64).toHaveBeenCalled();
      });
    });

    describe('get_album', () => {
      it('returns album details', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);

        const request = createMockCallToolRequest('get_album', { albumId: 'a1' });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ content: Array<{ text: string }> }> }).handleCallTool(request);

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.id).toBe('a1');
        expect(parsed.title).toBe('Test Album');
      });
    });

    describe('unknown tool', () => {
      it('throws McpError with MethodNotFound', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);

        const request = createMockCallToolRequest('nonexistent_tool');

        await expect(
          (core as unknown as { handleCallTool: (req: typeof request) => Promise<unknown> }).handleCallTool(request),
        ).rejects.toThrow(McpError);
      });
    });

    describe('error propagation', () => {
      it('returns isError response for non-McpError exceptions', async () => {
        vi.mocked(getFirstAvailableTokens).mockResolvedValue(mockTokens);
        vi.mocked(searchPhotosByText).mockRejectedValue(new Error('API failure'));

        const request = createMockCallToolRequest('search_photos', { query: 'test' });
        const result = await (core as unknown as { handleCallTool: (req: typeof request) => Promise<{ isError: boolean; content: Array<{ text: string }> }> }).handleCallTool(request);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('API failure');
      });
    });
  });

  describe('formatPhoto', () => {
    it('formats photo with all fields', () => {
      const photo = {
        id: 'p1',
        filename: 'test.jpg',
        description: 'A test photo',
        baseUrl: 'https://example.com/test',
        productUrl: 'https://photos.google.com/p1',
        mediaMetadata: { creationTime: '2024-01-01', width: '1000', height: '800' },
      };

      const result = (core as unknown as { formatPhoto: (p: typeof photo) => {
        id: string; filename: string; description: string; dateCreated: string;
        url: string; webUrl: string; width: string; height: string;
        location?: unknown;
      } }).formatPhoto(photo);

      expect(result.id).toBe('p1');
      expect(result.filename).toBe('test.jpg');
      expect(result.description).toBe('A test photo');
      expect(result.dateCreated).toBe('2024-01-01');
      expect(result.width).toBe('1000');
    });

    it('includes location when present', () => {
      const photo = {
        id: 'p1',
        filename: 'test.jpg',
        baseUrl: 'https://example.com',
        productUrl: 'https://photos.google.com',
        locationData: {
          latitude: 48.8566,
          longitude: 2.3522,
          city: 'Paris',
          countryName: 'France',
          approximate: false,
        },
      };

      const result = (core as unknown as { formatPhoto: (p: typeof photo) => {
        location?: { latitude: number; city: string; country: string };
      } }).formatPhoto(photo);

      expect(result.location).toBeDefined();
      if (result.location) {
        expect(result.location.city).toBe('Paris');
        expect(result.location.country).toBe('France');
      }
    });

    it('handles missing optional fields gracefully', () => {
      const photo = {
        id: 'p1',
        filename: 'test.jpg',
        baseUrl: 'https://example.com',
        productUrl: 'https://photos.google.com',
      };

      const result = (core as unknown as { formatPhoto: (p: typeof photo) => {
        description: string; dateCreated: string; width: string; height: string;
        location?: unknown;
      } }).formatPhoto(photo);

      expect(result.description).toBe('');
      expect(result.dateCreated).toBe('');
      expect(result.width).toBe('');
      expect(result.location).toBeUndefined();
    });
  });
});
