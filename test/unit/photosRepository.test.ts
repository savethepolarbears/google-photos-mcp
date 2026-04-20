/**
 * Unit tests for src/api/repositories/photosRepository.ts
 * Tests photo CRUD operations with mocked API client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/api/client.js", () => ({
  getPhotoClient: vi.fn(),
  toError: vi.fn((err: unknown, ctx: string) => new Error(`${ctx}: ${err}`)),
}));

vi.mock("../../src/utils/retry.js", () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../src/api/enrichment/locationEnricher.js", () => ({
  enrichPhotosWithLocation: vi.fn(),
}));

vi.mock("../../src/utils/location.js", () => ({
  getPhotoLocation: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
}));

import {
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
  listMediaItems,
  uploadMedia,
  batchCreateMediaItems,
} from "../../src/api/repositories/photosRepository.js";
import { getPhotoClient } from "../../src/api/client.js";
import type { OAuth2Client } from "google-auth-library";

const mockOAuth2Client = {} as OAuth2Client;

describe("listAlbumPhotos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns photos for a given album", async () => {
    const mockClient = {
      mediaItems: {
        search: vi.fn().mockResolvedValue({
          data: {
            mediaItems: [
              {
                id: "p1",
                filename: "photo1.jpg",
                baseUrl: "https://example.com/1",
                productUrl: "https://photos.google.com/1",
              },
            ],
            nextPageToken: "next",
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    const result = await listAlbumPhotos(mockOAuth2Client, "album-1", 25);

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe("p1");
    expect(result.nextPageToken).toBe("next");
  });

  it("returns empty photos for empty album", async () => {
    const mockClient = {
      mediaItems: {
        search: vi.fn().mockResolvedValue({ data: {} }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    const result = await listAlbumPhotos(mockOAuth2Client, "empty-album");

    expect(result.photos).toEqual([]);
  });
});

describe("getPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a photo by ID", async () => {
    const mockClient = {
      mediaItems: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: "p1",
            filename: "photo.jpg",
            baseUrl: "https://example.com/photo",
            productUrl: "https://photos.google.com/p1",
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    const result = await getPhoto(mockOAuth2Client, "p1", false);

    expect(result.id).toBe("p1");
    expect(result.filename).toBe("photo.jpg");
  });

  it("throws when photo not found (null data)", async () => {
    const mockClient = {
      mediaItems: {
        get: vi.fn().mockResolvedValue({ data: null }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    await expect(getPhoto(mockOAuth2Client, "nonexistent")).rejects.toThrow();
  });

  it("throws descriptive error on API failure", async () => {
    const mockClient = {
      mediaItems: {
        get: vi.fn().mockRejectedValue(new Error("API error")),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    await expect(getPhoto(mockOAuth2Client, "bad-id")).rejects.toThrow(
      "Failed to get photo",
    );
  });
});

describe("getPhotoAsBase64", () => {
  it("throws for empty URL", async () => {
    await expect(getPhotoAsBase64("")).rejects.toThrow("Invalid photo URL");
  });
});

describe("listMediaItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls photosClient.mediaItems.list({ pageSize, pageToken }) and returns { photos, nextPageToken }", async () => {
    const mockClient = {
      mediaItems: {
        list: vi.fn().mockResolvedValue({
          data: {
            mediaItems: [
              {
                id: "p1",
                filename: "photo1.jpg",
                baseUrl: "url",
                productUrl: "purl",
              },
            ],
            nextPageToken: "next",
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );
    const result = await listMediaItems(mockOAuth2Client, 25, "token");
    expect(result.photos).toHaveLength(1);
    expect(result.nextPageToken).toBe("next");
  });

  it("returns empty array when API returns no items", async () => {
    const mockClient = {
      mediaItems: {
        list: vi.fn().mockResolvedValue({ data: {} }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );
    const result = await listMediaItems(mockOAuth2Client, 25);
    expect(result.photos).toEqual([]);
  });
});

describe("uploadMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls photosClient.uploads.upload({ bytes, mimeType, fileName }) then photosClient.mediaItems.batchCreate(...) and returns { mediaItemId, uploadToken }", async () => {
    const mockClient = {
      uploads: {
        upload: vi.fn().mockResolvedValue({ uploadToken: "tok123" }),
      },
      mediaItems: {
        batchCreate: vi.fn().mockResolvedValue({
          data: {
            newMediaItemResults: [{ mediaItem: { id: "new-media-id" } }],
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );
    const result = await uploadMedia(
      mockOAuth2Client,
      "/tmp/photo.jpg",
      "image/jpeg",
      "photo.jpg",
    );
    expect(result.mediaItemId).toBe("new-media-id");
    expect(result.uploadToken).toBe("tok123");
  });

  it('throws "Failed to upload media" on upload step API failure', async () => {
    const mockClient = {
      uploads: {
        upload: vi.fn().mockRejectedValue(new Error("API failure")),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );
    await expect(
      uploadMedia(
        mockOAuth2Client,
        "/tmp/photo.jpg",
        "image/jpeg",
        "photo.jpg",
      ),
    ).rejects.toThrow("Failed to upload media");
  });
});

describe("batchCreateMediaItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls photosClient.mediaItems.batchCreate({ newMediaItems }) and returns { mediaItems }", async () => {
    const mockClient = {
      mediaItems: {
        batchCreate: vi.fn().mockResolvedValue({
          data: {
            newMediaItemResults: [
              {
                uploadToken: "tok123",
                status: {},
                mediaItem: { id: "new-media-id" },
              },
            ],
          },
        }),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );
    const result = await batchCreateMediaItems(mockOAuth2Client, [
      { description: "test", uploadToken: "tok123" },
    ]);
    expect(result.mediaItems).toBeDefined();
    expect(result.mediaItems[0].mediaItem?.id).toBe("new-media-id");
  });
});
