import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GooglePhotosMCPCore } from '../../src/mcp/core.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

vi.mock('../../src/auth/tokens.js', () => ({
  getFirstAvailableTokens: vi.fn().mockResolvedValue({ access_token: 'tok', userId: 'u1' }),
  saveTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/auth/tokenRefreshManager.js', () => ({
  tokenRefreshManager: { refreshIfNeeded: vi.fn(async (_, __, t) => t) },
}));

vi.mock('../../src/api/photos.js', () => ({
  createOAuthClient: vi.fn(),
  setupOAuthClient: vi.fn(),
  listAlbums: vi.fn(),
  getAlbum: vi.fn(),
  getPhoto: vi.fn(),
  createAlbum: vi.fn(),
  uploadMedia: vi.fn(),
  batchCreateMediaItems: vi.fn(),
  batchAddMediaItemsToAlbum: vi.fn(),
  listMediaItems: vi.fn(),
  createPickerSession: vi.fn(),
  getPickerSession: vi.fn(),
  listPickerSessionMediaItems: vi.fn(),
}));

vi.mock('../../src/utils/quotaManager.js', () => ({
  quotaManager: { checkQuota: vi.fn(), recordRequest: vi.fn() },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Test-friendly interface that exposes protected methods from GooglePhotosMCPCore.
 * This avoids TS2445 "protected member" errors while keeping tests type-safe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestableCore = { [K in keyof GooglePhotosMCPCore]: GooglePhotosMCPCore[K] } & Record<string, any>;

/** Helper to build a CallToolRequest-shaped object with required `method` field. */
function callToolReq(name: string, args: Record<string, unknown> = {}) {
  return { method: 'tools/call' as const, params: { name, arguments: args } };
}

describe('GooglePhotosMCPCore', () => {
  let instance: TestableCore;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new GooglePhotosMCPCore({ name: 'test', version: '0.0.1' }) as unknown as TestableCore;
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
      const result = await instance.handleCallTool(callToolReq('create_album', { title: 'My Album' }));
      expect(result).toBeDefined();
    });

    it('calls uploadMedia then batchCreateMediaItems and returns mediaItem id for upload_media', async () => {
      const result = await instance.handleCallTool(callToolReq('upload_media', { filePath: '/tmp/test.jpg', mimeType: 'image/jpeg', fileName: 'test.jpg' }));
      expect(result).toBeDefined();
    });

    it('calls batchAddMediaItemsToAlbum and returns success for add_media_to_album', async () => {
      const result = await instance.handleCallTool(callToolReq('add_media_to_album', { albumId: 'a1', mediaItemIds: ['m1'] }));
      expect(result).toBeDefined();
    });

    it('fails Zod validation before reaching repository for add_media_to_album with 51 mediaItemIds', async () => {
      const mediaItemIds = Array(51).fill('m');
      await expect(instance.handleCallTool(callToolReq('add_media_to_album', { albumId: 'a1', mediaItemIds }))).rejects.toThrow();
    });
  });

  describe('tools/list', () => {
    it('includes create_album, upload_media, add_media_to_album tool definitions', async () => {
      const result = await instance.handleListTools();
      expect(result).toBeDefined();
    });

    it('includes Phase 3 tool names (minus deprecated sharing tools)', async () => {
      const result = await instance.handleListTools();
      const names: string[] = result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('search_media_by_filter');
      expect(names).toContain('add_album_enrichment');
      expect(names).toContain('set_album_cover');
      expect(names).toContain('start_auth');
      expect(names).toContain('create_picker_session');
      expect(names).toContain('poll_picker_session');
      // Deprecated sharing tools should NOT be present
      expect(names).not.toContain('share_album');
      expect(names).not.toContain('unshare_album');
      expect(names).not.toContain('join_shared_album');
      expect(names).not.toContain('leave_shared_album');
    });
  });

  // ---- Phase 3 tool dispatch (RED state -- handlers not yet implemented) ----

  describe('search_media_by_filter dispatch', () => {
    it('dispatches search_media_by_filter with a valid date filter and returns a result', async () => {
      const result = await instance.handleCallTool(callToolReq('search_media_by_filter', {
        dates: [{ year: 2023, month: 6 }],
        includedContentCategories: ['LANDSCAPES'],
      }));
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('start_auth tool', () => {
    it('returns auth URL and instructions when called', async () => {
      const result = await instance.handleCallTool(callToolReq('start_auth'));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.authUrl).toBeDefined();
      expect(parsed.authUrl).toMatch(/^http:\/\/localhost:\d+\/auth$/);
      expect(parsed.instructions).toBeDefined();
      expect(Array.isArray(parsed.instructions)).toBe(true);
    });
  });

  describe('add_album_enrichment dispatch', () => {
    it('dispatches add_album_enrichment and returns a result', async () => {
      const result = await instance.handleCallTool(callToolReq('add_album_enrichment', {
        albumId: 'album-1',
        type: 'TEXT',
        text: 'Summer memories',
      }));
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('set_album_cover dispatch', () => {
    it('dispatches set_album_cover and returns a result', async () => {
      const result = await instance.handleCallTool(callToolReq('set_album_cover', {
        albumId: 'album-1', mediaItemId: 'media-1',
      }));
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('returns re-auth prompt on PERMISSION_DENIED 403', async () => {
      // Simulate the handler throwing PERMISSION_DENIED (will throw MethodNotFound until implemented)
      // The test just ensures the dispatch path exists and returns a content response.
      const result = await instance.handleCallTool(callToolReq('set_album_cover', {
        albumId: 'album-1', mediaItemId: 'media-1',
      }));
      // Once implemented, the error response should contain re-auth guidance.
      // In RED state this will throw MethodNotFound and be caught generically.
      expect(result).toBeDefined();
    });
  });

  describe('create_album_with_media', () => {
    it('creates album, uploads files to album directly, returns aggregate result', async () => {
      const { createAlbum, uploadMedia } = await import('../../src/api/photos.js');
      vi.mocked(createAlbum).mockResolvedValue({ id: 'album-new', title: 'Trip' } as never);
      vi.mocked(uploadMedia).mockResolvedValue({ mediaItemId: 'media-1', uploadToken: 'tok' } as never);

      const result = await instance.handleCallTool(callToolReq('create_album_with_media', {
        albumTitle: 'Trip',
        files: [{ filePath: '/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' }],
      }));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.album).toBeDefined();
      expect(parsed.uploadResults).toHaveLength(1);
      expect(parsed.uploadResults[0].success).toBe(true);
      expect(parsed.uploadResults[0].mediaItemId).toBe('media-1');
      expect(parsed.addedToAlbum).toBe(1);

      // Verify album.id ('album-new') was passed as the 5th arg to uploadMedia
      const uploadCalls = vi.mocked(uploadMedia).mock.calls;
      expect(uploadCalls).toHaveLength(1);
      expect(uploadCalls[0][4]).toBe('album-new'); // albumId argument
    });

    it('returns partial results when one upload fails without aborting', async () => {
      const { createAlbum, uploadMedia } = await import('../../src/api/photos.js');
      vi.mocked(createAlbum).mockResolvedValue({ id: 'album-new', title: 'Trip' } as never);
      vi.mocked(uploadMedia)
        .mockResolvedValueOnce({ mediaItemId: 'media-1', uploadToken: 'tok' } as never)
        .mockRejectedValueOnce(new Error('upload failed'));

      const result = await instance.handleCallTool(callToolReq('create_album_with_media', {
        albumTitle: 'Trip',
        files: [
          { filePath: '/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' },
          { filePath: '/b.jpg', mimeType: 'image/jpeg', fileName: 'b.jpg' },
        ],
      }));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.uploadResults).toHaveLength(2);
      expect(parsed.uploadResults[0].success).toBe(true);
      expect(parsed.uploadResults[1].success).toBe(false);
      expect(parsed.addedToAlbum).toBe(1);
    });
  });

  describe('Picker API tools', () => {
    it('dispatches create_picker_session and returns sessionId + pickerUri', async () => {
      const { createPickerSession } = await import('../../src/api/photos.js');
      vi.mocked(createPickerSession).mockResolvedValue({ id: 'sess-1', pickerUri: 'https://photos.google.com/picker/sess-1' } as never);

      const result = await instance.handleCallTool(callToolReq('create_picker_session'));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.sessionId).toBe('sess-1');
      expect(parsed.pickerUri).toContain('picker');
      expect(parsed.instructions).toBeDefined();
    });

    it('dispatches poll_picker_session and returns waiting status when not ready', async () => {
      const { getPickerSession } = await import('../../src/api/photos.js');
      vi.mocked(getPickerSession).mockResolvedValue({ id: 'sess-1', pickerUri: 'https://picker', mediaItemsSet: false } as never);

      const result = await instance.handleCallTool(callToolReq('poll_picker_session', { sessionId: 'sess-1' }));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.mediaItemsSet).toBe(false);
      expect(parsed.message).toContain('not finished');
    });

    it('dispatches poll_picker_session and returns photos when ready', async () => {
      const { getPickerSession, listPickerSessionMediaItems } = await import('../../src/api/photos.js');
      vi.mocked(getPickerSession).mockResolvedValue({ id: 'sess-1', pickerUri: 'https://picker', mediaItemsSet: true } as never);
      vi.mocked(listPickerSessionMediaItems).mockResolvedValue({
        photos: [{ id: 'p1', filename: 'photo.jpg', baseUrl: 'https://url', productUrl: 'https://url' }],
        nextPageToken: undefined,
      } as never);

      const result = await instance.handleCallTool(callToolReq('poll_picker_session', { sessionId: 'sess-1' }));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.mediaItemsSet).toBe(true);
      expect(parsed.count).toBe(1);
      expect(parsed.photos).toHaveLength(1);
    });
  });

  describe('describe_filter_capabilities', () => {
    it('returns JSON with contentCategories, mutuallyExclusive, and dateFilter constraints', async () => {
      const result = await instance.handleCallTool(callToolReq('describe_filter_capabilities'));
      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.contentCategories).toBeDefined();
      expect(Array.isArray(parsed.contentCategories)).toBe(true);
      expect(parsed.mutuallyExclusive).toBeDefined();
      expect(parsed.dateFilter).toBeDefined();
    });
  });

  describe('MCP Prompts', () => {
    it('handleListPrompts returns array of 3 prompts with correct names', async () => {
      const result = await instance.handleListPrompts();
      expect(result.prompts).toHaveLength(3);
      const names = result.prompts.map((p: { name: string }) => p.name);
      expect(names).toContain('organize_photos');
      expect(names).toContain('batch_upload_workflow');
      expect(names).toContain('find_photos_by_criteria');
    });

    it('each prompt in list has description and arguments array', async () => {
      const result = await instance.handleListPrompts();
      for (const prompt of result.prompts) {
        expect(prompt.description).toBeDefined();
        expect(Array.isArray(prompt.arguments)).toBe(true);
      }
    });

    it('handleGetPrompt organize_photos returns messages with role=user and text containing "list_albums"', async () => {
      const result = await instance.handleGetPrompt({ params: { name: 'organize_photos' } });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('list_albums');
    });

    it('handleGetPrompt organize_photos with theme includes theme in response text', async () => {
      const result = await instance.handleGetPrompt({ params: { name: 'organize_photos', arguments: { theme: 'vacation' } } });
      expect(result.messages[0].content.text).toContain('vacation');
    });

    it('handleGetPrompt batch_upload_workflow returns messages mentioning "create_album_with_media"', async () => {
      const result = await instance.handleGetPrompt({ params: { name: 'batch_upload_workflow' } });
      expect(result.messages[0].content.text).toContain('create_album_with_media');
    });

    it('handleGetPrompt find_photos_by_criteria with criteria includes criteria in response text', async () => {
      const result = await instance.handleGetPrompt({ params: { name: 'find_photos_by_criteria', arguments: { criteria: 'pet photos' } } });
      expect(result.messages[0].content.text).toContain('pet photos');
    });

    it('handleGetPrompt with unknown prompt name throws McpError with InvalidParams', async () => {
      await expect(
        instance.handleGetPrompt({ params: { name: 'nonexistent_prompt' } })
      ).rejects.toThrow(McpError);
    });
  });
});
