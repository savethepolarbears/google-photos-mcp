/**
 * Unit tests for src/schemas/toolSchemas.ts
 * Tests all 6 Zod schemas used for MCP tool input validation.
 */

import { describe, it, expect } from "vitest";
import {
  searchPhotosSchema,
  searchPhotosByLocationSchema,
  getPhotoSchema,
  listAlbumsSchema,
  getAlbumSchema,
  listAlbumPhotosSchema,
  createAlbumSchema,
  uploadMediaSchema,
  addMediaToAlbumSchema,
  searchMediaByFilterSchema,
  addEnrichmentSchema,
  setCoverPhotoSchema,
  createAlbumWithMediaSchema,
  describeFilterCapabilitiesSchema,
  createPickerSessionSchema,
  pollPickerSessionSchema,
  deletePickerSessionSchema,
  downloadPickerMediaSchema,
} from "../../src/schemas/toolSchemas.js";

describe("searchPhotosSchema", () => {
  it("accepts valid input with all fields", () => {
    const result = searchPhotosSchema.parse({
      query: "cats",
      pageSize: 10,
      pageToken: "abc",
      includeLocation: true,
    });
    expect(result.query).toBe("cats");
    expect(result.pageSize).toBe(10);
  });

  it("accepts minimal input with only query", () => {
    const result = searchPhotosSchema.parse({ query: "dogs" });
    expect(result.query).toBe("dogs");
    expect(result.pageSize).toBeUndefined();
  });

  it("rejects empty query", () => {
    expect(() => searchPhotosSchema.parse({ query: "" })).toThrow();
  });

  it("rejects query longer than 500 chars", () => {
    expect(() =>
      searchPhotosSchema.parse({ query: "a".repeat(501) }),
    ).toThrow();
  });

  it("rejects pageSize of 0", () => {
    expect(() =>
      searchPhotosSchema.parse({ query: "test", pageSize: 0 }),
    ).toThrow();
  });

  it("rejects pageSize over 100", () => {
    expect(() =>
      searchPhotosSchema.parse({ query: "test", pageSize: 101 }),
    ).toThrow();
  });

  it("rejects non-integer pageSize", () => {
    expect(() =>
      searchPhotosSchema.parse({ query: "test", pageSize: 2.5 }),
    ).toThrow();
  });
});

describe("searchPhotosByLocationSchema", () => {
  it("accepts valid locationName", () => {
    const result = searchPhotosByLocationSchema.parse({
      locationName: "Paris",
    });
    expect(result.locationName).toBe("Paris");
  });

  it("rejects empty locationName", () => {
    expect(() =>
      searchPhotosByLocationSchema.parse({ locationName: "" }),
    ).toThrow();
  });

  it("rejects locationName longer than 200 chars", () => {
    expect(() =>
      searchPhotosByLocationSchema.parse({ locationName: "a".repeat(201) }),
    ).toThrow();
  });
});

describe("getPhotoSchema", () => {
  it("accepts valid photoId", () => {
    const result = getPhotoSchema.parse({ photoId: "abc123" });
    expect(result.photoId).toBe("abc123");
  });

  it("accepts optional includeBase64 and includeLocation", () => {
    const result = getPhotoSchema.parse({
      photoId: "abc",
      includeBase64: true,
      includeLocation: false,
    });
    expect(result.includeBase64).toBe(true);
    expect(result.includeLocation).toBe(false);
  });

  it("rejects empty photoId", () => {
    expect(() => getPhotoSchema.parse({ photoId: "" })).toThrow();
  });

  it("rejects missing photoId", () => {
    expect(() => getPhotoSchema.parse({})).toThrow();
  });
});

describe("listAlbumsSchema", () => {
  it("accepts empty object", () => {
    const result = listAlbumsSchema.parse({});
    expect(result.pageSize).toBeUndefined();
  });

  it("accepts valid pageSize and pageToken", () => {
    const result = listAlbumsSchema.parse({ pageSize: 50, pageToken: "next" });
    expect(result.pageSize).toBe(50);
    expect(result.pageToken).toBe("next");
  });

  it("rejects pageSize over 100", () => {
    expect(() => listAlbumsSchema.parse({ pageSize: 101 })).toThrow();
  });
});

describe("getAlbumSchema", () => {
  it("accepts valid albumId", () => {
    const result = getAlbumSchema.parse({ albumId: "album-xyz" });
    expect(result.albumId).toBe("album-xyz");
  });

  it("rejects empty albumId", () => {
    expect(() => getAlbumSchema.parse({ albumId: "" })).toThrow();
  });

  it("rejects missing albumId", () => {
    expect(() => getAlbumSchema.parse({})).toThrow();
  });
});

describe("listAlbumPhotosSchema", () => {
  it("accepts valid input", () => {
    const result = listAlbumPhotosSchema.parse({
      albumId: "album-1",
      pageSize: 25,
      includeLocation: true,
    });
    expect(result.albumId).toBe("album-1");
  });

  it("rejects empty albumId", () => {
    expect(() => listAlbumPhotosSchema.parse({ albumId: "" })).toThrow();
  });

  it("rejects pageSize over 100", () => {
    expect(() =>
      listAlbumPhotosSchema.parse({ albumId: "album-1", pageSize: 101 }),
    ).toThrow();
  });
});

describe("createAlbumSchema", () => {
  it("accepts { title: 'My Album' }", () => {
    const result = createAlbumSchema.parse({ title: "My Album" });
    expect(result.title).toBe("My Album");
  });

  it("rejects empty title", () => {
    expect(() => createAlbumSchema.parse({ title: "" })).toThrow();
  });
});

describe("uploadMediaSchema", () => {
  it("accepts { filePath: '/tmp/photo.jpg', mimeType: 'image/jpeg', fileName: 'photo.jpg' }", () => {
    const result = uploadMediaSchema.parse({
      filePath: "/tmp/photo.jpg",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });
    expect(result.filePath).toBe("/tmp/photo.jpg");
  });

  it("accepts optional albumId and description", () => {
    const result = uploadMediaSchema.parse({
      filePath: "/tmp/photo.jpg",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      albumId: "a1",
      description: "desc",
    });
    expect(result.albumId).toBe("a1");
    expect(result.description).toBe("desc");
  });

  it("rejects missing filePath", () => {
    expect(() =>
      uploadMediaSchema.parse({
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
      }),
    ).toThrow();
  });
});

describe("addMediaToAlbumSchema", () => {
  it("accepts { albumId: 'a1', mediaItemIds: ['m1', 'm2'] }", () => {
    const result = addMediaToAlbumSchema.parse({
      albumId: "a1",
      mediaItemIds: ["m1", "m2"],
    });
    expect(result.albumId).toBe("a1");
    expect(result.mediaItemIds).toHaveLength(2);
  });

  it("rejects 0 mediaItemIds (min 1)", () => {
    expect(() =>
      addMediaToAlbumSchema.parse({ albumId: "a1", mediaItemIds: [] }),
    ).toThrow();
  });

  it("rejects 51 mediaItemIds (max 50)", () => {
    const mediaItemIds = Array(51).fill("m");
    expect(() =>
      addMediaToAlbumSchema.parse({ albumId: "a1", mediaItemIds }),
    ).toThrow();
  });

  it("rejects missing albumId", () => {
    expect(() =>
      addMediaToAlbumSchema.parse({ mediaItemIds: ["m1"] }),
    ).toThrow();
  });
});

// ---- Phase 3 schemas (RED state -- production code not yet written) ----

describe("searchMediaByFilterSchema", () => {
  const schema = searchMediaByFilterSchema;

  it("accepts valid date filter with content categories", () => {
    const result = schema.parse({
      dates: [{ year: 2023, month: 6 }],
      includedContentCategories: ["LANDSCAPES"],
    });
    expect(result).toBeDefined();
  });

  it("accepts valid dateRanges with mediaType", () => {
    const result = schema.parse({
      dateRanges: [
        {
          startDate: { year: 2023, month: 1, day: 1 },
          endDate: { year: 2023, month: 12, day: 31 },
        },
      ],
      mediaTypes: ["PHOTO"],
    });
    expect(result).toBeDefined();
  });

  it("rejects when both dates and dateRanges are set", () => {
    expect(() =>
      schema.parse({
        dates: [{ year: 2023 }],
        dateRanges: [
          {
            startDate: { year: 2023, month: 1, day: 1 },
            endDate: { year: 2023, month: 12, day: 31 },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than 5 dates", () => {
    const dates = Array(6).fill({ year: 2023 }) as unknown[];
    expect(() => schema.parse({ dates })).toThrow();
  });

  it("rejects more than 5 dateRanges", () => {
    const dateRanges = Array(6).fill({
      startDate: { year: 2023, month: 1, day: 1 },
      endDate: { year: 2023, month: 12, day: 31 },
    }) as unknown[];
    expect(() => schema.parse({ dateRanges })).toThrow();
  });
});

describe("addEnrichmentSchema", () => {
  const schema = addEnrichmentSchema;

  it("accepts valid TextEnrichment input", () => {
    const result = schema.parse({
      albumId: "album-1",
      type: "TEXT",
      text: "Summer vacation memories",
    });
    expect(result).toBeDefined();
  });

  it("accepts valid LocationEnrichment input", () => {
    const result = schema.parse({
      albumId: "album-1",
      type: "LOCATION",
      locationName: "Paris, France",
    });
    expect(result).toBeDefined();
  });
});

describe("setCoverPhotoSchema", () => {
  const schema = setCoverPhotoSchema;

  it("accepts valid albumId and mediaItemId", () => {
    const result = schema.parse({
      albumId: "album-1",
      mediaItemId: "media-item-1",
    });
    expect(result).toBeDefined();
  });
});

// ---- Phase 4 schemas ----

describe("createAlbumWithMediaSchema", () => {
  it("accepts valid albumTitle and files array", () => {
    const result = createAlbumWithMediaSchema.parse({
      albumTitle: "Trip",
      files: [
        { filePath: "/a.jpg", mimeType: "image/jpeg", fileName: "a.jpg" },
      ],
    });
    expect(result.albumTitle).toBe("Trip");
    expect(result.files).toHaveLength(1);
  });

  it("rejects empty files array", () => {
    expect(() =>
      createAlbumWithMediaSchema.parse({ albumTitle: "Trip", files: [] }),
    ).toThrow();
  });

  it("rejects files array with more than 50 items", () => {
    const files = Array(51).fill({
      filePath: "/a.jpg",
      mimeType: "image/jpeg",
      fileName: "a.jpg",
    });
    expect(() =>
      createAlbumWithMediaSchema.parse({ albumTitle: "Trip", files }),
    ).toThrow();
  });

  it("rejects missing albumTitle", () => {
    expect(() =>
      createAlbumWithMediaSchema.parse({
        files: [
          { filePath: "/a.jpg", mimeType: "image/jpeg", fileName: "a.jpg" },
        ],
      }),
    ).toThrow();
  });

  it("accepts optional description on file items", () => {
    const result = createAlbumWithMediaSchema.parse({
      albumTitle: "Trip",
      files: [
        {
          filePath: "/a.jpg",
          mimeType: "image/jpeg",
          fileName: "a.jpg",
          description: "Sunset",
        },
      ],
    });
    expect(result.files[0].description).toBe("Sunset");
  });
});

describe("describeFilterCapabilitiesSchema", () => {
  it("accepts empty object {}", () => {
    const result = describeFilterCapabilitiesSchema?.parse({});
    expect(result).toBeDefined();
  });

  it("accepts undefined (schema is optional)", () => {
    const result = describeFilterCapabilitiesSchema?.parse(undefined);
    expect(result).toBeUndefined();
  });
});

describe("createPickerSessionSchema", () => {
  it("accepts empty object {}", () => {
    const result = createPickerSessionSchema.parse({});
    expect(result.maxItemCount).toBeUndefined();
  });

  it("accepts valid maxItemCount within range (1-2000)", () => {
    const result = createPickerSessionSchema.parse({ maxItemCount: 50 });
    expect(result.maxItemCount).toBe(50);
  });

  it("rejects maxItemCount less than 1", () => {
    expect(() =>
      createPickerSessionSchema.parse({ maxItemCount: 0 }),
    ).toThrow();
  });

  it("rejects maxItemCount greater than 2000", () => {
    expect(() =>
      createPickerSessionSchema.parse({ maxItemCount: 2001 }),
    ).toThrow();
  });
});

describe("pollPickerSessionSchema", () => {
  it("accepts valid sessionId", () => {
    const result = pollPickerSessionSchema.parse({ sessionId: "sess-123" });
    expect(result.sessionId).toBe("sess-123");
    expect(result.pageSize).toBeUndefined();
  });

  it("accepts valid pagination arguments", () => {
    const result = pollPickerSessionSchema.parse({
      sessionId: "sess-123",
      pageSize: 50,
      pageToken: "next-page",
    });
    expect(result.pageSize).toBe(50);
    expect(result.pageToken).toBe("next-page");
  });

  it("rejects missing sessionId", () => {
    expect(() => pollPickerSessionSchema.parse({})).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() => pollPickerSessionSchema.parse({ sessionId: "" })).toThrow();
  });
});

describe("deletePickerSessionSchema", () => {
  it("accepts valid sessionId", () => {
    const result = deletePickerSessionSchema.parse({ sessionId: "sess-123" });
    expect(result.sessionId).toBe("sess-123");
  });

  it("rejects missing or empty sessionId", () => {
    expect(() => deletePickerSessionSchema.parse({})).toThrow();
    expect(() => deletePickerSessionSchema.parse({ sessionId: "" })).toThrow();
  });
});

describe("downloadPickerMediaSchema", () => {
  it("accepts valid baseUrl alone when isVideo or mimeType is provided", () => {
    const result1 = downloadPickerMediaSchema.parse({
      baseUrl: "https://photos.google.com/sample",
      isVideo: false,
    });
    expect(result1.baseUrl).toBe("https://photos.google.com/sample");

    const result2 = downloadPickerMediaSchema.parse({
      baseUrl: "https://photos.google.com/sample",
      mimeType: "video/mp4",
    });
    expect(result2.mimeType).toBe("video/mp4");
  });

  it("rejects baseUrl alone without isVideo or mimeType", () => {
    expect(() =>
      downloadPickerMediaSchema.parse({
        baseUrl: "https://photos.google.com/sample",
      }),
    ).toThrow(
      "When supplying baseUrl without sessionId, either isVideo or mimeType must be specified",
    );
  });

  it("accepts sessionId and mediaItemId together without baseUrl", () => {
    const result = downloadPickerMediaSchema.parse({
      sessionId: "sess-123",
      mediaItemId: "item-456",
    });
    expect(result.sessionId).toBe("sess-123");
    expect(result.mediaItemId).toBe("item-456");
  });

  it("accepts downloadOriginal, width, height, isVideo, savePath, and includeBase64", () => {
    const result = downloadPickerMediaSchema.parse({
      baseUrl: "https://photos.google.com/sample",
      downloadOriginal: false,
      width: 1920,
      height: 1080,
      isVideo: true,
      savePath: "/tmp/download.mp4",
      includeBase64: false,
    });
    expect(result.downloadOriginal).toBe(false);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.isVideo).toBe(true);
    expect(result.savePath).toBe("/tmp/download.mp4");
    expect(result.includeBase64).toBe(false);
  });

  it("rejects when neither baseUrl nor (sessionId and mediaItemId) are provided", () => {
    expect(() => downloadPickerMediaSchema.parse({})).toThrow(
      "Either baseUrl or both sessionId and mediaItemId must be provided",
    );
  });

  it("rejects when only sessionId is provided without mediaItemId or baseUrl", () => {
    expect(() =>
      downloadPickerMediaSchema.parse({ sessionId: "sess-123" }),
    ).toThrow(
      "Either baseUrl or both sessionId and mediaItemId must be provided",
    );
  });

  it("rejects non-HTTPS baseUrl", () => {
    expect(() =>
      downloadPickerMediaSchema.parse({
        baseUrl: "http://photos.google.com/sample",
      }),
    ).toThrow(
      "baseUrl must be an HTTPS URL on an official Google Photos media domain",
    );
  });

  it("rejects untrusted domains for baseUrl", () => {
    expect(() =>
      downloadPickerMediaSchema.parse({
        baseUrl: "https://evil-site.com/image.jpg",
      }),
    ).toThrow(
      "baseUrl must be an HTTPS URL on an official Google Photos media domain",
    );
  });

  it("accepts valid googleusercontent.com subdomain baseUrl with isVideo", () => {
    const result = downloadPickerMediaSchema.parse({
      baseUrl: "https://lh3.googleusercontent.com/lr/sample-photo",
      isVideo: false,
    });
    expect(result.baseUrl).toBe(
      "https://lh3.googleusercontent.com/lr/sample-photo",
    );
  });

  it("rejects when only mediaItemId is provided without sessionId or baseUrl", () => {
    expect(() =>
      downloadPickerMediaSchema.parse({ mediaItemId: "item-123" }),
    ).toThrow(
      "Either baseUrl or both sessionId and mediaItemId must be provided",
    );
  });
});
