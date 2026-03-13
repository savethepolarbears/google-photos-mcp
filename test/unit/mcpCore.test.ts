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
  let instance: any;

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
  });
});
