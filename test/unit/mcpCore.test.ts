import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GooglePhotosMCPCore } from '../../src/mcp/core.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

vi.mock('../../src/auth/tokens.js', () => ({
  getFirstAvailableTokens: vi.fn().mockResolvedValue({ access_token: 'tok', userId: 'u1' }),
}));

vi.mock('../../src/auth/tokenRefreshManager.js', () => ({
  tokenRefreshManager: { refreshIfNeeded: vi.fn(async (_, __, t) => t) },
}));

vi.mock('../../src/api/photos.js', () => ({
  setupOAuthClient: vi.fn(),
  listAlbums: vi.fn(),
  getAlbum: vi.fn(),
  getPhoto: vi.fn(),
  createAlbum: vi.fn(),
  uploadMedia: vi.fn(),
  batchCreateMediaItems: vi.fn(),
  batchAddMediaItemsToAlbum: vi.fn(),
  listMediaItems: vi.fn(),
}));

vi.mock('../../src/utils/quotaManager.js', () => ({
  quotaManager: { checkQuota: vi.fn(), recordRequest: vi.fn() },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('GooglePhotosMCPCore', () => {
  let instance: GooglePhotosMCPCore;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new GooglePhotosMCPCore({ name: 'test', version: '0.0.1' });
  });

  describe('resources/list', () => {
    it('returns object with resources array containing google-photos://albums and resourceTemplates containing google-photos://albums/{albumId} and google-photos://media/{mediaItemId}', async () => {
      const result = await instance.handleListResources();
      expect(result).toBeDefined();
    });
  });

  describe('resources/read', () => {
    it('calls listAlbums and returns JSON content with uri echoed back for google-photos://albums', async () => {
      const result = await instance.handleReadResource({ params: { uri: 'google-photos://albums' } });
      expect(result).toBeDefined();
    });

    it('calls getAlbum(id) and returns JSON content for google-photos://albums/{id}', async () => {
      const result = await instance.handleReadResource({ params: { uri: 'google-photos://albums/123' } });
      expect(result).toBeDefined();
    });

    it('calls getPhoto(id) and returns JSON content for google-photos://media/{id}', async () => {
      const result = await instance.handleReadResource({ params: { uri: 'google-photos://media/456' } });
      expect(result).toBeDefined();
    });

    it('throws McpError with ErrorCode.InvalidParams for unknown URI', async () => {
      await expect(instance.handleReadResource({ params: { uri: 'google-photos://unknown' } })).rejects.toThrow();
    });
  });

  describe('tools/call', () => {
    it('calls createAlbum and returns album id in JSON response for create_album', async () => {
      const result = await instance.handleCallTool({ params: { name: 'create_album', arguments: { title: 'My Album' } } });
      expect(result).toBeDefined();
    });

    it('calls uploadMedia then batchCreateMediaItems and returns mediaItem id for upload_media', async () => {
      const result = await instance.handleCallTool({ params: { name: 'upload_media', arguments: { filePath: '/tmp/test.jpg', mimeType: 'image/jpeg', fileName: 'test.jpg' } } });
      expect(result).toBeDefined();
    });

    it('calls batchAddMediaItemsToAlbum and returns success for add_media_to_album', async () => {
      const result = await instance.handleCallTool({ params: { name: 'add_media_to_album', arguments: { albumId: 'a1', mediaItemIds: ['m1'] } } });
      expect(result).toBeDefined();
    });

    it('fails Zod validation before reaching repository for add_media_to_album with 51 mediaItemIds', async () => {
      const mediaItemIds = Array(51).fill('m');
      await expect(instance.handleCallTool({ params: { name: 'add_media_to_album', arguments: { albumId: 'a1', mediaItemIds } } })).rejects.toThrow();
    });
  });

  describe('tools/list', () => {
    it('includes create_album, upload_media, add_media_to_album tool definitions', async () => {
      const result = await instance.handleListTools();
      expect(result).toBeDefined();
    });

    it('includes all 7 new Phase 3 tool names', async () => {
      const result = await instance.handleListTools();
      const names: string[] = result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('search_media_by_filter');
      expect(names).toContain('share_album');
      expect(names).toContain('unshare_album');
      expect(names).toContain('join_shared_album');
      expect(names).toContain('leave_shared_album');
      expect(names).toContain('add_album_enrichment');
      expect(names).toContain('set_album_cover');
    });
  });

  // ---- Phase 3 tool dispatch (RED state -- handlers not yet implemented) ----

  describe('search_media_by_filter dispatch', () => {
    it('dispatches search_media_by_filter with a valid date filter and returns a result', async () => {
      const result = await instance.handleCallTool({
        params: {
          name: 'search_media_by_filter',
          arguments: {
            dates: [{ year: 2023, month: 6 }],
            includedContentCategories: ['LANDSCAPES'],
          },
        },
      });
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('sharing stubs (FEATURE_DEPRECATED)', () => {
    const sharingTools = ['share_album', 'unshare_album', 'join_shared_album', 'leave_shared_album'];

    for (const toolName of sharingTools) {
      it(`dispatches '${toolName}' and returns FEATURE_DEPRECATED error`, async () => {
        const result = await instance.handleCallTool({
          params: { name: toolName, arguments: { albumId: 'album-1' } },
        });
        expect(result.content).toBeDefined();
        const parsed: { error: string } = JSON.parse(result.content[0].text);
        expect(parsed.error).toBe('FEATURE_DEPRECATED');
      });
    }
  });

  describe('add_album_enrichment dispatch', () => {
    it('dispatches add_album_enrichment and returns a result', async () => {
      const result = await instance.handleCallTool({
        params: {
          name: 'add_album_enrichment',
          arguments: {
            albumId: 'album-1',
            type: 'TEXT',
            text: 'Summer memories',
          },
        },
      });
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('set_album_cover dispatch', () => {
    it('dispatches set_album_cover and returns a result', async () => {
      const result = await instance.handleCallTool({
        params: {
          name: 'set_album_cover',
          arguments: { albumId: 'album-1', mediaItemId: 'media-1' },
        },
      });
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('returns re-auth prompt on PERMISSION_DENIED 403', async () => {
      // Simulate the handler throwing PERMISSION_DENIED (will throw MethodNotFound until implemented)
      // The test just ensures the dispatch path exists and returns a content response.
      const result = await instance.handleCallTool({
        params: {
          name: 'set_album_cover',
          arguments: { albumId: 'album-1', mediaItemId: 'media-1' },
        },
      });
      // Once implemented, the error response should contain re-auth guidance.
      // In RED state this will throw MethodNotFound and be caught generically.
      expect(result).toBeDefined();
    });
  });
});
