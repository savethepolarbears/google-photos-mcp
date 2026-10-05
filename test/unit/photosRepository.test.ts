/**
 * Unit tests for src/api/repositories/photosRepository.ts
 * Tests photo CRUD operations with mocked API client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/api/client.js", () => ({
  getPhotoClient: vi.fn(),
  getPickerClient: vi.fn(),
  httpsAgent: {},
  toError: vi.fn((err: unknown, ctx: string) => {
    if (err instanceof Error) {
      return new Error(`Google Photos API ${ctx} failed: ${err.message}`);
    }
    return new Error(`${ctx}: ${err}`);
  }),
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
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/quotaManager.js", () => ({
  quotaManager: {
    checkQuota: vi.fn(),
    recordRequest: vi.fn(),
    getStats: vi.fn(),
  },
}));

import axios from "axios";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import os from "os";
import {
  listAlbumPhotos,
  getPhoto,
  getPhotoAsBase64,
  listMediaItems,
  uploadMedia,
  batchCreateMediaItems,
  createPickerSession,
  getPickerSession,
  deletePickerSession,
  listPickerSessionMediaItems,
  downloadPickerMedia,
  isAllowedGooglePhotosMediaUrl,
} from "../../src/api/repositories/photosRepository.js";
import { quotaManager } from "../../src/utils/quotaManager.js";
import { getPhotoClient, getPickerClient } from "../../src/api/client.js";
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

  it("preserves 401 unauthorized guidance in thrown error", async () => {
    const mockClient = {
      mediaItems: {
        list: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "Unauthorized (401). Use the start_auth tool or visit /auth to re-authenticate.",
            ),
          ),
      },
    };
    vi.mocked(getPhotoClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPhotoClient>,
    );

    await expect(listMediaItems(mockOAuth2Client, 25)).rejects.toThrow(
      "Use the start_auth tool or visit /auth to re-authenticate",
    );
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

describe("Picker API repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createPickerSession calls sessions.create and returns session", async () => {
    const mockClient = {
      sessions: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: "sess-123",
            pickerUri: "https://photos.google.com/picker",
            pollingConfig: { pollInterval: "3s", timeoutIn: "300s" },
          },
        }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    const result = await createPickerSession(mockOAuth2Client, {
      maxItemCount: 10,
    });
    expect(result.id).toBe("sess-123");
    expect(mockClient.sessions.create).toHaveBeenCalledWith({
      maxItemCount: 10,
    });
  });

  it("getPickerSession calls sessions.get with sessionId", async () => {
    const mockClient = {
      sessions: {
        get: vi.fn().mockResolvedValue({
          data: { id: "sess-123", mediaItemsSet: true },
        }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    const result = await getPickerSession(mockOAuth2Client, "sess-123");
    expect(result.id).toBe("sess-123");
    expect(result.mediaItemsSet).toBe(true);
  });

  it("deletePickerSession calls sessions.delete with sessionId", async () => {
    const mockClient = {
      sessions: {
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    await deletePickerSession(mockOAuth2Client, "sess-123");
    expect(mockClient.sessions.delete).toHaveBeenCalledWith("sess-123");
  });

  it("listPickerSessionMediaItems maps media items correctly", async () => {
    const mockClient = {
      sessions: {
        listMediaItems: vi.fn().mockResolvedValue({
          data: {
            mediaItems: [
              {
                id: "picked-1",
                createTime: "2026-01-01T00:00:00Z",
                mediaFile: {
                  filename: "sample.jpg",
                  baseUrl: "https://photos.google.com/sample",
                  mimeType: "image/jpeg",
                  mediaFileMetadata: { width: 1920, height: 1080 },
                },
              },
            ],
            nextPageToken: "next-token",
          },
        }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    const result = await listPickerSessionMediaItems(
      mockOAuth2Client,
      "sess-123",
      25,
    );
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe("picked-1");
    expect(result.photos[0].filename).toBe("sample.jpg");
    expect(result.photos[0].mediaMetadata?.width).toBe("1920");
    expect(result.photos[0].mediaMetadata?.height).toBe("1080");
    expect(result.nextPageToken).toBe("next-token");
  });

  describe("downloadPickerMedia", () => {
    it("downloads media bytes from baseUrl with Authorization header", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const fakeBytes = Buffer.from("image-bytes-123");
      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(fakeBytes),
        headers: { "content-type": "image/jpeg" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://photos.google.com/sample-photo",
        downloadOriginal: true,
        isVideo: false,
      });

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.size).toBe(fakeBytes.length);
      expect(result.base64Data).toBe(fakeBytes.toString("base64"));
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://photos.google.com/sample-photo=d",
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer test-picker-token",
          }),
          responseType: "stream",
        }),
      );

      axiosGetSpy.mockRestore();
    });

    it("looks up mediaItemId in session when baseUrl is omitted", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockClient = {
        sessions: {
          listMediaItems: vi.fn().mockResolvedValue({
            data: {
              mediaItems: [
                {
                  id: "picked-item-99",
                  mediaFile: {
                    baseUrl: "https://photos.google.com/item-99-url",
                    filename: "item99.png",
                    mimeType: "image/png",
                  },
                },
              ],
            },
          }),
        },
      };
      vi.mocked(getPickerClient).mockReturnValue(
        mockClient as unknown as ReturnType<typeof getPickerClient>,
      );

      const fakeBytes = Buffer.from("item-99-bytes");
      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(fakeBytes),
        headers: { "content-type": "image/png" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-123",
        mediaItemId: "picked-item-99",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("item99.png");
      expect(result.mimeType).toBe("image/png");
      expect(result.size).toBe(fakeBytes.length);

      axiosGetSpy.mockRestore();
    });

    it("saves media bytes to disk when savePath is provided", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picker-test-"));
      const testFilePath = path.join(tempDir, "test-output.jpg");
      try {
        const mockOAuthClient = {
          getRequestHeaders: vi
            .fn()
            .mockResolvedValue(
              new Map([["authorization", "Bearer test-picker-token"]]),
            ),
        } as unknown as OAuth2Client;

        const fakeBytes = Buffer.from("file-on-disk-bytes");
        const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
          data: Readable.from(fakeBytes),
          headers: { "content-type": "image/jpeg" },
        });

        const result = await downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://photos.google.com/sample-photo",
          savePath: testFilePath,
          isVideo: false,
        });

        expect(result.success).toBe(true);
        expect(result.savedTo).toBe(testFilePath);
        expect(result.size).toBe(fakeBytes.length);
        expect(fs.readFileSync(testFilePath)).toEqual(fakeBytes);

        axiosGetSpy.mockRestore();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("rejects when neither baseUrl nor sessionId+mediaItemId are provided", async () => {
      await expect(downloadPickerMedia(mockOAuth2Client, {})).rejects.toThrow(
        "Either baseUrl or both sessionId and mediaItemId must be provided",
      );
    });

    it("rejects untrusted or non-HTTPS domains to prevent token exfiltration", async () => {
      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "http://photos.google.com/sample-photo",
        }),
      ).rejects.toThrow("Invalid or untrusted baseUrl");

      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://attacker.com/steal-token",
        }),
      ).rejects.toThrow("Invalid or untrusted baseUrl");

      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://evil-googleusercontent.com/photo",
        }),
      ).rejects.toThrow("Invalid or untrusted baseUrl");
    });

    it("rejects when specifying baseUrl without sessionId and omitting isVideo and mimeType", async () => {
      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://photos.google.com/sample-photo",
        }),
      ).rejects.toThrow(
        "When specifying baseUrl without sessionId, either isVideo or mimeType must be provided to determine the correct download parameters (=d or =dv)",
      );
    });

    it("infers video downloads (=dv) from MIME type when isVideo is omitted in session lookup", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockClient = {
        sessions: {
          listMediaItems: vi.fn().mockResolvedValue({
            data: {
              mediaItems: [
                {
                  id: "video-item-1",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/video-url",
                    filename: "clip.mp4",
                    mimeType: "video/mp4",
                  },
                },
              ],
            },
          }),
        },
      };
      vi.mocked(getPickerClient).mockReturnValue(
        mockClient as unknown as ReturnType<typeof getPickerClient>,
      );

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("video-bytes")),
        headers: { "content-type": "video/mp4" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-v",
        mediaItemId: "video-item-1",
      });

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe("video/mp4");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/video-url=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("infers video downloads (=dv) from filename extension when isVideo is omitted in session lookup", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockClient = {
        sessions: {
          listMediaItems: vi.fn().mockResolvedValue({
            data: {
              mediaItems: [
                {
                  id: "mov-item-2",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/mov-url",
                    filename: "vacation.mov",
                  },
                },
              ],
            },
          }),
        },
      };
      vi.mocked(getPickerClient).mockReturnValue(
        mockClient as unknown as ReturnType<typeof getPickerClient>,
      );

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("mov-bytes")),
        headers: {},
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-mov",
        mediaItemId: "mov-item-2",
      });

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe("video/mp4");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/mov-url=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("infers media type from session when baseUrl is provided with sessionId and isVideo is omitted", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockClient = {
        sessions: {
          listMediaItems: vi.fn().mockResolvedValue({
            data: {
              mediaItems: [
                {
                  id: "vid-target",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/session-video-base",
                    filename: "sunset.mp4",
                    mimeType: "video/mp4",
                  },
                },
              ],
            },
          }),
        },
      };
      vi.mocked(getPickerClient).mockReturnValue(
        mockClient as unknown as ReturnType<typeof getPickerClient>,
      );

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("streamed-video-data")),
        headers: { "content-type": "video/mp4" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/session-video-base",
        sessionId: "sess-video-lookup",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("sunset.mp4");
      expect(result.mimeType).toBe("video/mp4");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/session-video-base=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("infers video download when baseUrl is provided with mimeType video/*", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("video-bytes")),
        headers: { "content-type": "video/webm" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/direct-video",
        mimeType: "video/webm",
      });

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe("video/webm");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/direct-video=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("defaults omitted dimensions to 2048x2048 when downloadOriginal is false", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("preview-bytes")),
        headers: { "content-type": "image/jpeg" },
      });

      await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/sample-photo",
        downloadOriginal: false,
        isVideo: false,
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/sample-photo=w2048-h2048",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("defaults omitted dimension to maintain aspect ratio without failing with 0", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const axiosGetSpy = vi.spyOn(axios, "get").mockImplementation(async () => ({
        data: Readable.from(Buffer.from("image-bytes")),
        headers: { "content-type": "image/jpeg" },
      }));

      // Width only
      await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/sample-photo",
        width: 800,
        isVideo: false,
      });
      expect(axiosGetSpy).toHaveBeenLastCalledWith(
        "https://lh3.googleusercontent.com/sample-photo=w800-h800",
        expect.anything(),
      );

      // Height only
      await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/sample-photo",
        height: 600,
        isVideo: false,
      });
      expect(axiosGetSpy).toHaveBeenLastCalledWith(
        "https://lh3.googleusercontent.com/sample-photo=w600-h600",
        expect.anything(),
      );

      // Both width and height
      await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/sample-photo",
        width: 1200,
        height: 900,
        isVideo: false,
      });
      expect(axiosGetSpy).toHaveBeenLastCalledWith(
        "https://lh3.googleusercontent.com/sample-photo=w1200-h900",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("aborts and rejects oversized base64 response exceeding 10MB memory limit via content-length header", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const fakeStream = Readable.from(Buffer.from("tiny-chunk"));
      const destroySpy = vi.spyOn(fakeStream, "destroy");

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: fakeStream,
        headers: {
          "content-type": "video/mp4",
          "content-length": "25000000",
        },
      });

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/big-video",
          isVideo: true,
        }),
      ).rejects.toThrow(
        "Media item size (25000000 bytes) exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.",
      );

      expect(destroySpy).toHaveBeenCalled();
      axiosGetSpy.mockRestore();
    });

    it("aborts and rejects oversized base64 response when chunks exceed 10MB during streaming", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // Stream emitting 11MB chunk without content-length header
      const chunk11MB = Buffer.alloc(11 * 1024 * 1024);
      const fakeStream = Readable.from([chunk11MB]);
      const destroySpy = vi.spyOn(fakeStream, "destroy");

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: fakeStream,
        headers: { "content-type": "video/mp4" },
      });

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/big-chunk-video",
          isVideo: true,
        }),
      ).rejects.toThrow(
        "Media item size exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.",
      );

      expect(destroySpy).toHaveBeenCalled();
      axiosGetSpy.mockRestore();
    });

    it("rejects includeBase64 when saved file exceeds 10MB limit", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picker-test-"));
      const testFilePath = path.join(tempDir, "big-test.jpg");
      try {
        const mockOAuthClient = {
          getRequestHeaders: vi
            .fn()
            .mockResolvedValue(
              new Map([["authorization", "Bearer test-picker-token"]]),
            ),
        } as unknown as OAuth2Client;

        // Create a 11MB file to simulate large saved file
        const bigBytes = Buffer.alloc(11 * 1024 * 1024);
        const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
          data: Readable.from([bigBytes]),
          headers: { "content-type": "image/jpeg" },
        });

        await expect(
          downloadPickerMedia(mockOAuthClient, {
            baseUrl: "https://lh3.googleusercontent.com/big-saved-file",
            savePath: testFilePath,
            includeBase64: true,
            isVideo: false,
          }),
        ).rejects.toThrow("exceeds maximum allowable base64 limit of 10MB");

        axiosGetSpy.mockRestore();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("accounts for each paginated lookup page and media download in quota tracking", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockClient = {
        sessions: {
          listMediaItems: vi
            .fn()
            // Page 1: item not found, next page token returned
            .mockResolvedValueOnce({
              data: {
                mediaItems: [
                  {
                    id: "other-item-1",
                    mediaFile: {
                      baseUrl: "https://lh3.googleusercontent.com/other-1",
                    },
                  },
                ],
                nextPageToken: "page-2-token",
              },
            })
            // Page 2: item found
            .mockResolvedValueOnce({
              data: {
                mediaItems: [
                  {
                    id: "target-item-2",
                    mediaFile: {
                      baseUrl: "https://lh3.googleusercontent.com/target-2",
                      filename: "target.jpg",
                      mimeType: "image/jpeg",
                    },
                  },
                ],
              },
            }),
        },
      };
      vi.mocked(getPickerClient).mockReturnValue(
        mockClient as unknown as ReturnType<typeof getPickerClient>,
      );

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("image-data")),
        headers: { "content-type": "image/jpeg" },
      });

      vi.mocked(quotaManager.checkQuota).mockClear();
      vi.mocked(quotaManager.recordRequest).mockClear();

      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "paginated-sess",
        mediaItemId: "target-item-2",
      });

      expect(result.success).toBe(true);
      // Quota checked for page 1 and page 2 (metadata: isMediaRequest = false)
      expect(quotaManager.checkQuota).toHaveBeenCalledWith(false);
      expect(quotaManager.recordRequest).toHaveBeenCalledWith(false);
      // Quota checked for media download (media: isMediaRequest = true)
      expect(quotaManager.checkQuota).toHaveBeenCalledWith(true);
      expect(quotaManager.recordRequest).toHaveBeenCalledWith(true);

      // Total calls: 2 metadata calls + 1 media call = 3 quota checks & records
      expect(quotaManager.checkQuota).toHaveBeenCalledTimes(3);
      expect(quotaManager.recordRequest).toHaveBeenCalledTimes(3);

      axiosGetSpy.mockRestore();
    });
  });

  describe("isAllowedGooglePhotosMediaUrl", () => {
    it("returns true for official Google Photos domains over HTTPS", () => {
      expect(
        isAllowedGooglePhotosMediaUrl(
          "https://lh3.googleusercontent.com/lr/ANi1O8-photo",
        ),
      ).toBe(true);
      expect(
        isAllowedGooglePhotosMediaUrl("https://photos.google.com/photo/123"),
      ).toBe(true);
      expect(
        isAllowedGooglePhotosMediaUrl(
          "https://photoslibrary.googleapis.com/v1/mediaItems/xyz",
        ),
      ).toBe(true);
    });

    it("returns false for non-HTTPS or untrusted domains", () => {
      expect(
        isAllowedGooglePhotosMediaUrl("http://lh3.googleusercontent.com/test"),
      ).toBe(false);
      expect(isAllowedGooglePhotosMediaUrl("https://evil.com/test")).toBe(
        false,
      );
      expect(
        isAllowedGooglePhotosMediaUrl("https://not-googleusercontent.com/test"),
      ).toBe(false);
    });
  });
});
