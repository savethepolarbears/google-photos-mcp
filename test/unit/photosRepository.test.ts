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
import childProcess from "child_process";
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
  preserveDestinationPermissions,
  MAX_ENCODED_BASE64_BYTES,
  MAX_RAW_BASE64_BYTES,
} from "../../src/api/repositories/photosRepository.js";
import { withRetry } from "../../src/utils/retry.js";
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

  it("records quota for each retry attempt in deletePickerSession", async () => {
    let callCount = 0;
    const mockClient = {
      sessions: {
        delete: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error("503 Service Unavailable");
          }
          return { data: {} };
        }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    vi.mocked(withRetry).mockImplementationOnce(
      async (fn: () => Promise<unknown>) => {
        let lastErr;
        for (let i = 0; i < 3; i++) {
          try {
            return await fn();
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      },
    );

    vi.mocked(quotaManager.checkQuota).mockClear();
    vi.mocked(quotaManager.recordRequest).mockClear();

    await deletePickerSession(mockOAuth2Client, "sess-del-retry");

    expect(mockClient.sessions.delete).toHaveBeenCalledTimes(3);
    expect(quotaManager.checkQuota).toHaveBeenCalledTimes(3);
    expect(quotaManager.recordRequest).toHaveBeenCalledTimes(3);
    expect(quotaManager.checkQuota).toHaveBeenCalledWith(false);
    expect(quotaManager.recordRequest).toHaveBeenCalledWith(false);
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
              {
                id: "video-picked-2",
                createTime: "2026-01-02T00:00:00Z",
                mediaFile: {
                  filename: "sample.mp4",
                  baseUrl: "https://photos.google.com/video-sample",
                  mimeType: "video/mp4",
                  mediaFileMetadata: {
                    width: 1920,
                    height: 1080,
                    videoMetadata: {
                      fps: 30,
                      processingStatus: "PROCESSING",
                    },
                  },
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
    expect(result.photos).toHaveLength(2);
    expect(result.photos[0].id).toBe("picked-1");
    expect(result.photos[0].filename).toBe("sample.jpg");
    expect(result.photos[0].mediaMetadata?.width).toBe("1920");
    expect(result.photos[0].mediaMetadata?.height).toBe("1080");

    expect(result.photos[1].id).toBe("video-picked-2");
    expect(result.photos[1].processingStatus).toBe("PROCESSING");
    expect(result.photos[1].mediaMetadata?.video?.status).toBe("PROCESSING");
    expect(result.photos[1].mediaMetadata?.video?.fps).toBe(30);
    expect(result.nextPageToken).toBe("next-token");
  });

  it("records quota for each retry attempt in listPickerSessionMediaItems", async () => {
    let callCount = 0;
    const mockClient = {
      sessions: {
        listMediaItems: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error("503 Service Unavailable");
          }
          return {
            data: {
              mediaItems: [
                {
                  id: "retried-item",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/retried",
                    filename: "retried.jpg",
                  },
                },
              ],
            },
          };
        }),
      },
    };
    vi.mocked(getPickerClient).mockReturnValue(
      mockClient as unknown as ReturnType<typeof getPickerClient>,
    );

    vi.mocked(withRetry).mockImplementationOnce(
      async (fn: () => Promise<unknown>) => {
        let lastErr;
        for (let i = 0; i < 3; i++) {
          try {
            return await fn();
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      },
    );

    vi.mocked(quotaManager.checkQuota).mockClear();
    vi.mocked(quotaManager.recordRequest).mockClear();

    const result = await listPickerSessionMediaItems(
      mockOAuth2Client,
      "sess-retry",
    );

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe("retried-item");
    expect(quotaManager.checkQuota).toHaveBeenCalledTimes(3);
    expect(quotaManager.recordRequest).toHaveBeenCalledTimes(3);
    expect(quotaManager.checkQuota).toHaveBeenCalledWith(false);
    expect(quotaManager.recordRequest).toHaveBeenCalledWith(false);
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

    it("preserves pre-existing destination file and cleans up temporary file when download stream fails", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picker-preserve-"));
      const testFilePath = path.join(tempDir, "existing-file.jpg");
      const existingBytes = Buffer.from("pre-existing-important-data");
      fs.writeFileSync(testFilePath, existingBytes);

      try {
        const mockOAuthClient = {
          getRequestHeaders: vi
            .fn()
            .mockResolvedValue(
              new Map([["authorization", "Bearer test-picker-token"]]),
            ),
        } as unknown as OAuth2Client;

        // Create a readable stream that errors mid-way
        const failingStream = new Readable({
          read() {
            this.destroy(new Error("Connection reset by peer mid-stream"));
          },
        });

        const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
          data: failingStream,
          headers: { "content-type": "image/jpeg" },
        });

        await expect(
          downloadPickerMedia(mockOAuthClient, {
            baseUrl: "https://photos.google.com/sample-photo",
            savePath: testFilePath,
            isVideo: false,
          }),
        ).rejects.toThrow("Connection reset by peer mid-stream");

        // The pre-existing file must remain intact with original bytes
        expect(fs.existsSync(testFilePath)).toBe(true);
        expect(fs.readFileSync(testFilePath)).toEqual(existingBytes);

        // No leftover temporary files in directory
        const filesInDir = fs.readdirSync(tempDir);
        expect(filesInDir).toEqual(["existing-file.jpg"]);

        axiosGetSpy.mockRestore();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("preserves pre-existing restrictive file permissions (0600) when replacing an existing file", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picker-mode-"));
      const testFilePath = path.join(tempDir, "private-file.jpg");
      fs.writeFileSync(testFilePath, "old-bytes", { mode: 0o600 });

      try {
        const mockOAuthClient = {
          getRequestHeaders: vi
            .fn()
            .mockResolvedValue(
              new Map([["authorization", "Bearer test-picker-token"]]),
            ),
        } as unknown as OAuth2Client;

        const fakeBytes = Buffer.from("new-bytes-replacing-old");
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
        expect(fs.readFileSync(testFilePath)).toEqual(fakeBytes);

        if (process.platform !== "win32") {
          const stats = fs.statSync(testFilePath);
          expect(stats.mode & 0o777).toBe(0o600);
        }

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

    it("rejects includeBase64: false when savePath is omitted", async () => {
      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://photos.google.com/sample-photo",
          isVideo: false,
          includeBase64: false,
        }),
      ).rejects.toThrow(
        "savePath must be provided when includeBase64 is false",
      );
    });

    it("rejects width and height outside 1-16383 range in downloadPickerMedia", async () => {
      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://photos.google.com/sample-photo",
          isVideo: false,
          width: 20000,
        }),
      ).rejects.toThrow("width must be an integer between 1 and 16383");

      await expect(
        downloadPickerMedia(mockOAuth2Client, {
          baseUrl: "https://photos.google.com/sample-photo",
          isVideo: false,
          height: 0,
        }),
      ).rejects.toThrow("height must be an integer between 1 and 16383");
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
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "READY",
                      },
                    },
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
      expect(result.isTranscoded).toBe(true);
      expect(result.mimeType).toBe("video/mp4");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/video-url=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("rejects video download when video processingStatus is PROCESSING with retry guidance", async () => {
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
                  id: "video-proc-1",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/video-proc",
                    filename: "processing.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "PROCESSING",
                      },
                    },
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-proc",
          mediaItemId: "video-proc-1",
        }),
      ).rejects.toThrow(
        'Video video-proc-1 is currently being processed by Google Photos (processingStatus: "PROCESSING"). Video bytes can only be requested once processing status is READY. Please poll the session again later before downloading.',
      );

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/video-proc",
          mimeType: "video/mp4",
          processingStatus: "PROCESSING",
        }),
      ).rejects.toThrow("processingStatus: \"PROCESSING\"");
    });

    it("rejects video download when video processingStatus is FAILED", async () => {
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
                  id: "video-fail-1",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/video-fail",
                    filename: "corrupt.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "FAILED",
                      },
                    },
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-fail",
          mediaItemId: "video-fail-1",
        }),
      ).rejects.toThrow(
        'Video video-fail-1 failed processing in Google Photos (processingStatus: "FAILED"). Video bytes cannot be retrieved.',
      );
    });

    it("rejects video download when processingStatus is missing or not explicitly READY", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // Case 1: Session item has UNSPECIFIED processing status
      const mockClient = {
        sessions: {
          listMediaItems: vi.fn().mockResolvedValue({
            data: {
              mediaItems: [
                {
                  id: "video-unspec-1",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/video-unspec",
                    filename: "unspec.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "PROCESSING_STATUS_UNSPECIFIED",
                      },
                    },
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-unspec",
          mediaItemId: "video-unspec-1",
        }),
      ).rejects.toThrow(
        "Google Photos requires video processingStatus to be explicitly READY before downloading video bytes (=dv)",
      );

      // Case 2: Base-URL-only form without processingStatus
      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/direct-video-no-status",
          mimeType: "video/mp4",
        }),
      ).rejects.toThrow(
        "Google Photos requires video processingStatus to be explicitly READY before downloading video bytes (=dv)",
      );
    });

    it("rejects when baseUrl and mediaItemId refer to different items in the session", async () => {
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
                  id: "item-1",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/item-1-url",
                    filename: "photo1.jpg",
                    mimeType: "image/jpeg",
                  },
                },
                {
                  id: "item-2",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/item-2-url",
                    filename: "photo2.jpg",
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

      // Caller provides item-1's baseUrl, but item-2's mediaItemId
      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-conflict",
          baseUrl: "https://lh3.googleusercontent.com/item-1-url",
          mediaItemId: "item-2",
        }),
      ).rejects.toThrow(
        "refer to different items in Picker session sess-conflict. Both must identify the same item.",
      );
    });

    it("accepts when baseUrl and mediaItemId identify the same item in the session", async () => {
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
                  id: "item-match",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/item-match-url",
                    filename: "photo-match.jpg",
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
        data: Readable.from(Buffer.from("img-bytes")),
        headers: { "content-type": "image/jpeg" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-match",
        baseUrl: "https://lh3.googleusercontent.com/item-match-url",
        mediaItemId: "item-match",
      });

      expect(result.success).toBe(true);
      expect(result.filename).toBe("photo-match.jpg");
      axiosGetSpy.mockRestore();
    });

    it("prefers fresh READY processingStatus from session over stale PROCESSING supplied by caller", async () => {
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
                  id: "video-fresh-ready",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/fresh-ready-url",
                    filename: "video.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "READY",
                      },
                    },
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

      // Caller passes stale PROCESSING, but session has fresh READY
      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-fresh",
        mediaItemId: "video-fresh-ready",
        processingStatus: "PROCESSING",
      });

      expect(result.success).toBe(true);
      expect(result.isTranscoded).toBe(true);
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/fresh-ready-url=dv",
        expect.anything(),
      );
      axiosGetSpy.mockRestore();
    });

    it("rejects video download when session returns PROCESSING even if caller supplied stale READY", async () => {
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
                  id: "video-fresh-proc",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/fresh-proc-url",
                    filename: "video.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "PROCESSING",
                      },
                    },
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

      // Caller passes stale READY, but session actually has PROCESSING
      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-proc-truth",
          mediaItemId: "video-fresh-proc",
          processingStatus: "READY",
        }),
      ).rejects.toThrow(
        'Video video-fresh-proc is currently being processed by Google Photos (processingStatus: "PROCESSING")',
      );
    });

    it("prefers session video type over caller isVideo: false when resolving from session", async () => {
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
                  id: "video-auth-type",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/video-auth-url",
                    filename: "clip.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "READY",
                      },
                    },
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

      // Caller passes isVideo: false, but session item is actually a video
      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-video-precedence",
        mediaItemId: "video-auth-type",
        isVideo: false,
      });

      expect(result.success).toBe(true);
      expect(result.isTranscoded).toBe(true);
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/video-auth-url=dv",
        expect.anything(),
      );
      axiosGetSpy.mockRestore();
    });

    it("prefers session photo type over caller isVideo: true when resolving from session", async () => {
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
                  id: "photo-auth-type",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/photo-auth-url",
                    filename: "image.jpg",
                    mimeType: "image/jpeg",
                    mediaFileMetadata: {
                      photoMetadata: {},
                    },
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
        data: Readable.from(Buffer.from("image-bytes")),
        headers: { "content-type": "image/jpeg" },
      });

      // Caller passes isVideo: true, but session item is actually an image
      const result = await downloadPickerMedia(mockOAuthClient, {
        sessionId: "sess-photo-precedence",
        mediaItemId: "photo-auth-type",
        isVideo: true,
      });

      expect(result.success).toBe(true);
      expect(result.isTranscoded).toBeUndefined();
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/photo-auth-url=d",
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
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "READY",
                      },
                    },
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
      expect(result.isTranscoded).toBe(true);
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
                    mediaFileMetadata: {
                      videoMetadata: {
                        processingStatus: "READY",
                      },
                    },
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
      expect(result.isTranscoded).toBe(true);
      expect(result.filename).toBe("sunset.mp4");
      expect(result.mimeType).toBe("video/mp4");
      expect(axiosGetSpy).toHaveBeenCalledWith(
        "https://lh3.googleusercontent.com/session-video-base=dv",
        expect.anything(),
      );

      axiosGetSpy.mockRestore();
    });

    it("clears caller-supplied READY status and rejects video download when session item omits processingStatus (baseUrl + sessionId)", async () => {
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
                    mediaFileMetadata: {
                      videoMetadata: {
                        // Notice: processingStatus is absent/undefined
                      },
                    },
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/session-video-base",
          sessionId: "sess-video-lookup",
          processingStatus: "READY",
        }),
      ).rejects.toThrow(
        'Video vid-target cannot be downloaded: video processingStatus is not specified (unknown). Google Photos requires video processingStatus to be explicitly READY before downloading video bytes (=dv). Please poll the session until status is READY before downloading bytes.',
      );
    });

    it("clears caller-supplied READY status and rejects video download when session item omits processingStatus (mediaItemId + sessionId)", async () => {
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
                  id: "vid-id-lookup",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/session-video-id",
                    filename: "clip.mp4",
                    mimeType: "video/mp4",
                    mediaFileMetadata: {
                      videoMetadata: {},
                    },
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-video-id",
          mediaItemId: "vid-id-lookup",
          processingStatus: "READY",
        }),
      ).rejects.toThrow(
        'Video vid-id-lookup cannot be downloaded: video processingStatus is not specified (unknown). Google Photos requires video processingStatus to be explicitly READY before downloading video bytes (=dv). Please poll the session until status is READY before downloading bytes.',
      );
    });

    it("rejects when baseUrl is not found in session and isVideo/mimeType are omitted", async () => {
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
                  id: "unrelated-item",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/unrelated",
                    filename: "unrelated.jpg",
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

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/different-item",
          sessionId: "sess-mismatch",
        }),
      ).rejects.toThrow(
        "Could not find matching media item for baseUrl in Picker session sess-mismatch",
      );
    });

    it("requires exact mediaItemId equality and rejects suffix-only matches in session lookup", async () => {
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
                  id: "prefix-item-123",
                  mediaFile: {
                    baseUrl: "https://lh3.googleusercontent.com/prefix-url",
                    filename: "prefix.jpg",
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

      // searchId is "123", which matches .endsWith("123") of "prefix-item-123", but is not equal
      await expect(
        downloadPickerMedia(mockOAuthClient, {
          sessionId: "sess-exact",
          mediaItemId: "123",
        }),
      ).rejects.toThrow(
        "Media item 123 not found in Picker session sess-exact",
      );
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
        processingStatus: "READY",
      });

      expect(result.success).toBe(true);
      expect(result.isTranscoded).toBe(true);
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
          processingStatus: "READY",
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
          processingStatus: "READY",
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

    it("rejects binary payloads larger than ~7.5MB raw (e.g. 8MB) whose base64 expansion exceeds 10MB (in-memory chunks)", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // 8MB raw payload: below 10MB in raw bytes, but expands to ~11.2MB in base64
      const chunk8MB = Buffer.alloc(8 * 1024 * 1024);
      const fakeStream = Readable.from([chunk8MB]);
      const destroySpy = vi.spyOn(fakeStream, "destroy");

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: fakeStream,
        headers: { "content-type": "image/jpeg" },
      });

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/eight-mb-photo",
          isVideo: false,
        }),
      ).rejects.toThrow(
        "Media item size exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.",
      );

      expect(destroySpy).toHaveBeenCalled();
      axiosGetSpy.mockRestore();
    });

    it("rejects binary payloads larger than ~7.5MB raw via content-length header to prevent memory expansion", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const fakeStream = Readable.from(Buffer.from("small-chunk"));
      const destroySpy = vi.spyOn(fakeStream, "destroy");

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: fakeStream,
        headers: {
          "content-type": "image/jpeg",
          "content-length": "8388608", // 8MB
        },
      });

      await expect(
        downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://lh3.googleusercontent.com/eight-mb-header-photo",
          isVideo: false,
        }),
      ).rejects.toThrow(
        "Media item size (8388608 bytes) exceeds maximum allowable base64 response limit of 10MB. Please specify 'savePath' to stream large media directly to disk.",
      );

      expect(destroySpy).toHaveBeenCalled();
      axiosGetSpy.mockRestore();
    });

    it("rejects includeBase64 on saved files between 7.5MB and 10MB raw (e.g. 8MB) where base64 would exceed 10MB", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "picker-test-8mb-"));
      const testFilePath = path.join(tempDir, "eight-mb.jpg");
      try {
        const mockOAuthClient = {
          getRequestHeaders: vi
            .fn()
            .mockResolvedValue(
              new Map([["authorization", "Bearer test-picker-token"]]),
            ),
        } as unknown as OAuth2Client;

        const eightMbBytes = Buffer.alloc(8 * 1024 * 1024);
        const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
          data: Readable.from([eightMbBytes]),
          headers: { "content-type": "image/jpeg" },
        });

        await expect(
          downloadPickerMedia(mockOAuthClient, {
            baseUrl: "https://lh3.googleusercontent.com/eight-mb-saved",
            savePath: testFilePath,
            includeBase64: true,
            isVideo: false,
          }),
        ).rejects.toThrow(
          "Media size (8388608 bytes) exceeds maximum allowable base64 limit of 10MB. File was successfully saved to",
        );

        expect(fs.existsSync(testFilePath)).toBe(true);
        expect(fs.statSync(testFilePath).size).toBe(8 * 1024 * 1024);
        axiosGetSpy.mockRestore();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("accepts payloads under 7.5MB raw and produces base64 within the 10MB cap", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // 1MB raw payload -> ~1.33MB base64
      const oneMbBuffer = Buffer.alloc(1024 * 1024, "a");
      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from([oneMbBuffer]),
        headers: { "content-type": "image/jpeg" },
      });

      const result = await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://lh3.googleusercontent.com/one-mb-photo",
        isVideo: false,
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(1024 * 1024);
      expect(typeof result.base64Data).toBe("string");
      expect(result.base64Data?.length).toBeLessThanOrEqual(
        MAX_ENCODED_BASE64_BYTES,
      );
      expect(result.base64Data?.length).toBe(
        Math.ceil((1024 * 1024) / 3) * 4,
      );
      expect(MAX_RAW_BASE64_BYTES).toBe(7864320);
      axiosGetSpy.mockRestore();
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

    it("records quota for each retry attempt on transient download errors", async () => {
      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // Simulate withRetry executing up to 3 attempts on error
      vi.mocked(withRetry).mockImplementationOnce(
        async (fn: () => Promise<unknown>) => {
          let lastErr;
          for (let i = 0; i < 3; i++) {
            try {
              return await fn();
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr;
        },
      );

      let callCount = 0;
      const axiosGetSpy = vi
        .spyOn(axios, "get")
        .mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            const err = Object.assign(new Error("503 Service Unavailable"), {
              response: { status: 503 },
            });
            throw err;
          }
          return {
            data: Readable.from(Buffer.from("media-data")),
            headers: { "content-type": "image/jpeg" },
          };
        });

      vi.mocked(quotaManager.checkQuota).mockClear();
      vi.mocked(quotaManager.recordRequest).mockClear();

      const result = await downloadPickerMedia(mockOAuthClient, {
        baseUrl: "https://photos.google.com/sample-photo",
        isVideo: false,
      });

      expect(result.success).toBe(true);
      // Called 3 times: 2 transient failures retried + 1 success on third attempt
      expect(quotaManager.checkQuota).toHaveBeenCalledTimes(3);
      expect(quotaManager.recordRequest).toHaveBeenCalledTimes(3);
      expect(quotaManager.checkQuota).toHaveBeenCalledWith(true);
      expect(quotaManager.recordRequest).toHaveBeenCalledWith(true);

      axiosGetSpy.mockRestore();
    });
  });

  describe("preserveDestinationPermissions", () => {
    it("preserves Unix mode bits from destination file to temporary file", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data", { mode: 0o600 });
        fs.writeFileSync(tempFile, "temp-data", { mode: 0o644 });

        preserveDestinationPermissions(destFile, tempFile);

        if (process.platform !== "win32") {
          const stats = fs.statSync(tempFile);
          expect(stats.mode & 0o777).toBe(0o600);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("handles non-existent destination gracefully", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-none-"));
      const destFile = path.join(tempDir, "nonexistent.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(tempFile, "temp-data", { mode: 0o644 });
        expect(() => {
          preserveDestinationPermissions(destFile, tempFile);
        }).not.toThrow();

        if (process.platform !== "win32") {
          const stats = fs.statSync(tempFile);
          expect(stats.mode & 0o777).toBe(0o600);
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("enforces owner-only ACL on Windows if destination does not exist", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-new-dest-test-"));
      const destFile = path.join(tempDir, "nonexistent.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(tempFile, "temp-data");
        Object.defineProperty(process, "platform", { value: "win32" });

        preserveDestinationPermissions(destFile, tempFile);

        expect(execSpy).toHaveBeenCalledWith(
          "icacls.exe",
          [tempFile, "/inheritance:r", "/grant:r", "testwinuser:(F)"],
          { stdio: "ignore" },
        );
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("preserves owner-only ACL on Windows if destination has inheritance disabled", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-perm-test-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data");
        fs.writeFileSync(tempFile, "temp-data");

        Object.defineProperty(process, "platform", { value: "win32" });

        // Mock icacls output for destination to simulate inheritance disabled
        execSpy.mockImplementation((cmd, args) => {
          if (args && args[0] === destFile) {
            return "dest.jpg testwinuser:(F)\r\nSuccessfully processed 1 files";
          }
          return Buffer.from("");
        });

        preserveDestinationPermissions(destFile, tempFile);

        expect(execSpy).toHaveBeenCalledWith(
          "icacls.exe",
          [tempFile, "/inheritance:r", "/grant:r", "testwinuser:(F)"],
          { stdio: "ignore" },
        );
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws and fails closed on Windows if icacls fails", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockImplementation(() => {
          throw new Error("icacls error: Access is denied");
        });
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-icacls-fail-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data");
        fs.writeFileSync(tempFile, "temp-data");
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(() => {
          preserveDestinationPermissions(destFile, tempFile);
        }).toThrow("Could not verify or preserve Windows ACL");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws and fails closed on Windows if username is missing", () => {
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      const originalUser = process.env.USER;
      delete process.env.USERNAME;
      delete process.env.USER;

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-user-fail-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data");
        fs.writeFileSync(tempFile, "temp-data");
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(() => {
          preserveDestinationPermissions(destFile, tempFile);
        }).toThrow("Could not determine Windows username");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        process.env.USERNAME = originalUsername;
        process.env.USER = originalUser;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws and fails closed on Windows if chmodSync fails", () => {
      const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
        throw new Error("EPERM: operation not permitted");
      });
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "win-chmod-fail-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data");
        fs.writeFileSync(tempFile, "temp-data");
        Object.defineProperty(process, "platform", { value: "win32" });

        expect(() => {
          preserveDestinationPermissions(destFile, tempFile);
        }).toThrow("Could not synchronize file mode on Windows");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        chmodSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws and fails closed on Unix if chmodSync fails", () => {
      if (process.platform === "win32") return;

      const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
        throw new Error("EPERM: operation not permitted");
      });

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unix-chmod-fail-"));
      const destFile = path.join(tempDir, "dest.jpg");
      const tempFile = path.join(tempDir, "temp.jpg");

      try {
        fs.writeFileSync(destFile, "dest-data", { mode: 0o600 });
        fs.writeFileSync(tempFile, "temp-data", { mode: 0o644 });

        expect(() => {
          preserveDestinationPermissions(destFile, tempFile);
        }).toThrow("Could not enforce mode");
      } finally {
        chmodSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("aborts downloadPickerMedia, cleans up temp file, and preserves existing destination if permission preservation throws", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "abort-perm-test-"));
      const destFile = path.join(tempDir, "existing-dest.jpg");

      const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
        throw new Error("Simulated permission error");
      });

      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: Readable.from(Buffer.from("new-bytes")),
        headers: { "content-type": "image/jpeg" },
      });

      try {
        fs.writeFileSync(destFile, "original-protected-data", { mode: 0o600 });

        await expect(
          downloadPickerMedia(mockOAuthClient, {
            baseUrl: "https://photos.google.com/sample-photo",
            savePath: destFile,
            isVideo: false,
          }),
        ).rejects.toThrow();

        // Verify existing destination file was NOT replaced or corrupted
        expect(fs.readFileSync(destFile, "utf8")).toBe("original-protected-data");

        // Verify no leftover .tmp files exist in directory
        const leftoverFiles = fs.readdirSync(tempDir);
        expect(leftoverFiles).toEqual(["existing-dest.jpg"]);
      } finally {
        chmodSpy.mockRestore();
        axiosGetSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("applies destination permissions to temporary file before streaming any media bytes", async () => {
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pre-stream-perm-test-"),
      );
      const destFile = path.join(tempDir, "existing-dest.jpg");

      let permissionsCheckedBeforeStream = false;
      let streamRead = false;

      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      // Custom stream to detect when bytes are read
      const readable = new Readable({
        read() {
          streamRead = true;
          this.push(Buffer.from("media-data-chunk"));
          this.push(null);
        },
      });

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: readable,
        headers: { "content-type": "image/jpeg" },
      });

      // Spy on chmodSync to check that it is called on the temp file before streamRead is true
      const chmodSpy = vi
        .spyOn(fs, "chmodSync")
        .mockImplementation((targetPath) => {
          if (
            typeof targetPath === "string" &&
            targetPath.includes(".tmp.") &&
            !streamRead
          ) {
            permissionsCheckedBeforeStream = true;
          }
        });

      try {
        fs.writeFileSync(destFile, "initial-protected-data", { mode: 0o600 });

        const result = await downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://photos.google.com/sample-photo",
          savePath: destFile,
          isVideo: false,
        });

        expect(result.success).toBe(true);
        expect(permissionsCheckedBeforeStream).toBe(true);
      } finally {
        chmodSpy.mockRestore();
        axiosGetSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("applies owner-only Windows ACL to temporary file before streaming when savePath is new", async () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "win-stream-new-dest-"),
      );
      const destFile = path.join(tempDir, "new-dest.jpg");

      let aclAppliedBeforeStream = false;
      let streamRead = false;

      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const readable = new Readable({
        read() {
          streamRead = true;
          this.push(Buffer.from("media-data-chunk"));
          this.push(null);
        },
      });

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: readable,
        headers: { "content-type": "image/jpeg" },
      });

      execSpy.mockImplementation((cmd, args) => {
        if (
          cmd === "icacls.exe" &&
          args &&
          typeof args[0] === "string" &&
          args[0].includes(".tmp.") &&
          !streamRead
        ) {
          aclAppliedBeforeStream = true;
        }
        return Buffer.from("");
      });

      try {
        Object.defineProperty(process, "platform", { value: "win32" });

        const result = await downloadPickerMedia(mockOAuthClient, {
          baseUrl: "https://photos.google.com/sample-photo",
          savePath: destFile,
          isVideo: false,
        });

        expect(result.success).toBe(true);
        expect(aclAppliedBeforeStream).toBe(true);
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        execSpy.mockRestore();
        axiosGetSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("destroys response stream when file setup or destination preparation throws before streaming", async () => {
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "stream-destroy-test-"),
      );
      const destFile = path.join(tempDir, "existing-dest.jpg");

      const chmodSpy = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
        throw new Error("Simulated file setup error");
      });

      const mockOAuthClient = {
        getRequestHeaders: vi
          .fn()
          .mockResolvedValue(
            new Map([["authorization", "Bearer test-picker-token"]]),
          ),
      } as unknown as OAuth2Client;

      const mockStream = new Readable({
        read() {
          this.push(Buffer.from("mock-data"));
          this.push(null);
        },
      });
      const destroySpy = vi.spyOn(mockStream, "destroy");

      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValue({
        data: mockStream,
        headers: { "content-type": "image/jpeg" },
      });

      try {
        fs.writeFileSync(destFile, "original-data", { mode: 0o600 });

        await expect(
          downloadPickerMedia(mockOAuthClient, {
            baseUrl: "https://photos.google.com/sample-photo",
            savePath: destFile,
            isVideo: false,
          }),
        ).rejects.toThrow();

        expect(destroySpy).toHaveBeenCalled();
      } finally {
        chmodSpy.mockRestore();
        axiosGetSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
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
