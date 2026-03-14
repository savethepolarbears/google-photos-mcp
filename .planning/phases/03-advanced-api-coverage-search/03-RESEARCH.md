# Phase 3: Advanced API Coverage & Search - Research

**Researched:** 2026-03-13
**Domain:** Google Photos Library API v1 — search filters, album enrichments, cover photos, sharing endpoints
**Confidence:** HIGH (official API docs + codebase analysis)

## Summary

Phase 3 adds the remaining untouched Google Photos Library API surface: structured search filters (READ-04, FULL-04), album enrichments (FULL-02), album cover photo updates (FULL-03), and shared album management (FULL-01). The codebase already has a solid foundation — `SearchFilter` types are defined in `types.ts`, `buildFiltersFromQuery` exists in `filterBuilder.ts`, and `mediaItems.search` is wired in `client.ts`. Phase 3 is primarily an MCP tool exposure and repository function expansion effort, not a net-new infrastructure build.

**Critical blocker discovered:** The `photoslibrary.sharing` scope was permanently removed on March 31, 2025. `albums.share`, `albums.unshare`, `sharedAlbums.join`, `sharedAlbums.leave`, and `sharedAlbums.list` are completely non-functional. FULL-01 cannot be implemented as originally conceived and must be handled with a graceful degradation strategy (stub tools returning an authoritative deprecation explanation).

The `albums.addEnrichment` endpoint (FULL-02) and `albums.patch` for cover photos (FULL-03) still work but are restricted to app-created albums only, requiring the `photoslibrary.appendonly` or `photoslibrary.edit.appcreateddata` scope. The structured search filter tools (READ-04, FULL-04) work fully for app-created media.

**Primary recommendation:** Implement READ-04 and FULL-04 as first-class tools using the existing `SearchFilter` infrastructure. Implement FULL-02 (enrichment) and FULL-03 (cover photo via `albums.patch`) for app-created albums. For FULL-01, implement stub tools that return a clear deprecation notice — do not silently fail or omit them from the tool list.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| READ-04 | AI can search media by basic parameters (date, category) | `SearchFilter.dateFilter` and `contentFilter` already typed; `buildFiltersFromQuery` partially implements this; needs a direct `search_media` MCP tool with explicit structured inputs rather than relying on NLP parsing |
| FULL-01 | AI can manage shared albums (join, leave, share, unshare) | BLOCKED: `photoslibrary.sharing` scope removed March 31, 2025; all sharing endpoints return 403; implement stubs with deprecation messaging |
| FULL-02 | AI can manage album enrichments (add text/location to albums) | `albums.addEnrichment` still works; POST `/albums/{albumId}:addEnrichment`; requires `photoslibrary.appendonly` scope (already acquired in Phase 2) |
| FULL-03 | AI can set album cover photos | `albums.patch` still works; PATCH `/albums/{albumId}` with `updateMask=coverPhotoMediaItemId`; requires `photoslibrary.edit.appcreateddata` scope |
| FULL-04 | AI can perform advanced media search using complex filters | Full `SearchFilter` object already in `types.ts`; needs MCP tool that exposes structured inputs (date ranges, categories, media type, features) instead of text query |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP tool registration and dispatch | Already in use; `CallToolRequest`, `McpError`, `ErrorCode` pattern established |
| `zod` | ^3.24.2 | Input schema validation for new tool args | Already used for all existing tool schemas in `src/schemas/toolSchemas.ts` |
| `axios` | ^1.7.9 | HTTP calls to `photoslibrary.googleapis.com/v1` | Already wired in `client.ts` with keep-alive agent |
| `google-auth-library` | ^9.15.1 | `OAuth2Client` for authorized headers | Already used everywhere |
| `vitest` | ^3.0.6 | Unit tests | Already configured; `test/unit/*.test.ts` pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `winston` | ^3.17.0 | Error/info logging | All repository functions follow `logger.error(...)` pattern |

**No new npm dependencies required for Phase 3.**

---

## Architecture Patterns

### Recommended Project Structure additions
```
src/
├── api/
│   ├── repositories/
│   │   └── albumsRepository.ts     # add: addEnrichment, patchAlbum (cover photo), sharing stubs
│   └── client.ts                   # add: albums.addEnrichment, albums.patch, albums.share stubs
├── schemas/
│   └── toolSchemas.ts              # add: searchMediaSchema, addEnrichmentSchema, setCoverPhotoSchema, sharing stub schemas
└── mcp/
    └── core.ts                     # add: tool definitions + handlers for 5 new tools
test/
└── unit/
    ├── albumsRepository.test.ts    # extend: addEnrichment, patchAlbum, sharing stubs
    └── mcpCore.test.ts             # extend: new tool dispatch cases
```

### Pattern 1: Structured Search Filter Tool (READ-04, FULL-04)

**What:** Expose `search_media_by_filter` tool with explicit typed inputs mapping directly to `SearchFilter`.
**When to use:** When AI needs deterministic filter-based retrieval, not NLP guessing.
**Constraint:** `albumId` and `filters` are mutually exclusive per API spec.

```typescript
// Zod schema — src/schemas/toolSchemas.ts
export const searchMediaByFilterSchema = z.object({
  // Date filter: up to 5 specific dates OR up to 5 date ranges (not both)
  dates: z.array(z.object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
  })).max(5).optional(),
  dateRanges: z.array(z.object({
    startDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
    endDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
  })).max(5).optional(),
  // Content categories
  includedCategories: z.array(z.enum([
    'LANDSCAPES', 'RECEIPTS', 'CITYSCAPES', 'LANDMARKS', 'SELFIES', 'PEOPLE',
    'PETS', 'WEDDINGS', 'BIRTHDAYS', 'DOCUMENTS', 'TRAVEL', 'ANIMALS', 'FOOD',
    'SPORT', 'NIGHT', 'PERFORMANCES', 'WHITEBOARDS', 'SCREENSHOTS', 'UTILITY',
    'ARTS', 'CRAFTS', 'FASHION', 'HOUSES', 'GARDENS', 'FLOWERS', 'HOLIDAYS',
  ])).optional(),
  excludedCategories: z.array(z.enum([/* same enum */])).optional(),
  // Media type — only one value per request
  mediaType: z.enum(['ALL_MEDIA', 'PHOTO', 'VIDEO']).optional(),
  // Feature filter
  includeFavorites: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  pageToken: z.string().optional(),
}).refine(data => !(data.dates && data.dateRanges), {
  message: 'Use either dates or dateRanges, not both',
});
```

### Pattern 2: Album Enrichment Tool (FULL-02)

**What:** `add_album_enrichment` — POST to `/albums/{albumId}:addEnrichment`.
**Scope required:** `photoslibrary.appendonly` (already acquired in Phase 2 — no re-auth required).
**Enrichment types:** `TextEnrichment`, `LocationEnrichment`, `MapEnrichment`.
**Album position:** `FIRST_IN_ALBUM`, `LAST_IN_ALBUM`, `AFTER_MEDIA_ITEM`, `AFTER_ENRICHMENT_ITEM`.

```typescript
// Client method to add to client.ts albums object:
addEnrichment: async (params: {
  albumId: string;
  newEnrichmentItem: TextEnrichment | LocationEnrichment | MapEnrichment;
  albumPosition: AlbumPosition;
}) => {
  const headers = await getAuthorizedHeaders(auth);
  const response = await photosApi.post(
    `/albums/${params.albumId}:addEnrichment`,
    { newEnrichmentItem: params.newEnrichmentItem, albumPosition: params.albumPosition },
    { headers }
  );
  return { data: response.data };
};
```

### Pattern 3: Set Album Cover Photo (FULL-03)

**What:** `set_album_cover` — PATCH `/albums/{albumId}` with `updateMask=coverPhotoMediaItemId`.
**Scope required:** `photoslibrary.edit.appcreateddata` — this scope is NOT currently in the OAuth flow. Re-auth prompt required if absent.

```typescript
// Client method:
patch: async (params: { albumId: string; coverPhotoMediaItemId?: string; title?: string }) => {
  const headers = await getAuthorizedHeaders(auth);
  const updateFields = [];
  const body: Record<string, string> = {};
  if (params.coverPhotoMediaItemId) { updateFields.push('coverPhotoMediaItemId'); body.coverPhotoMediaItemId = params.coverPhotoMediaItemId; }
  if (params.title) { updateFields.push('title'); body.title = params.title; }
  const response = await photosApi.patch(
    `/albums/${params.albumId}`,
    body,
    { params: { updateMask: updateFields.join(',') }, headers }
  );
  return { data: response.data };
};
```

### Pattern 4: Sharing Stubs (FULL-01)

**What:** Register `share_album`, `unshare_album`, `join_shared_album`, `leave_shared_album` tools that immediately return an authoritative deprecation message.
**Why stubs and not omit:** The planner MUST mark FULL-01 complete. Omitting tools would silently leave the requirement unaddressed. Stubs communicate the constraint clearly to AI agents.

```typescript
// In handleCallTool switch:
case 'share_album':
case 'unshare_album':
case 'join_shared_album':
case 'leave_shared_album':
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'FEATURE_DEPRECATED',
        message: 'Google Photos sharing API was permanently removed on March 31, 2025. ' +
          'The photoslibrary.sharing scope is no longer valid. ' +
          'Sharing management is not possible via the Google Photos Library API.',
      }),
    }],
  };
```

### Anti-Patterns to Avoid

- **Conflating albumId + filters:** The `mediaItems.search` API explicitly rejects requests that set both `albumId` and `filters`. The Zod schema and handler must enforce mutual exclusivity.
- **Assuming sharing scope works:** Do not attempt OAuth re-auth to get `photoslibrary.sharing` — the scope is removed server-side, not just deprecated. Any token request for it will fail.
- **Using `dates` and `dateRanges` together:** API returns error if both are set in a single `dateFilter`. Zod `.refine()` must catch this.
- **Assuming `photoslibrary.edit.appcreateddata` is already granted:** Phase 2 acquired `photoslibrary.appendonly`. The `patch` endpoint for cover photos requires `edit.appcreateddata`. The handler must check for 403 and return a re-auth prompt identical to the PERMISSION_DENIED pattern already in `handleCreateAlbum`.
- **More than 5 date entries:** `dateFilter.dates` and `dateFilter.ranges` each have a max of 5 entries. Enforce in Zod.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SearchFilter construction | Custom filter parser | Extend existing `buildFiltersFromQuery` + new structured schema | `filterBuilder.ts` already handles category/date mapping; the tool schema enforces structure |
| HTTP retry on new endpoints | Custom retry | `withRetry` from `utils/retry.ts` | Already wraps all repository calls with exponential backoff |
| Auth header injection | Manual header building | `getAuthorizedHeaders(auth)` from `oauth.ts` | Already handles token refresh integration |
| Input validation | Manual type checks | Zod schemas in `toolSchemas.ts` + `validateArgs` | Pattern established and consistent across all existing tools |

---

## Common Pitfalls

### Pitfall 1: albumId XOR filters constraint
**What goes wrong:** Sending both `albumId` and `filters` in a `mediaItems.search` call causes the API to return 400.
**Why it happens:** Google Photos API treats album-scoped search and filter-based search as separate query modes.
**How to avoid:** Zod `.refine()` to reject both fields simultaneously. Handler must not pass `albumId` when filters are present.
**Warning signs:** 400 response with message about conflicting parameters.

### Pitfall 2: photoslibrary.edit.appcreateddata scope not yet granted
**What goes wrong:** `albums.patch` for cover photo returns 403 PERMISSION_DENIED.
**Why it happens:** OAuth consent screen was not shown with this scope during Phase 2 auth.
**How to avoid:** Detect PERMISSION_DENIED in the `set_album_cover` handler (same pattern as `handleCreateAlbum`). Return a user-facing message prompting re-auth at `http://localhost:3000/auth`.
**Warning signs:** 403 with `PERMISSION_DENIED` body.

### Pitfall 3: Enrichment only works on app-created albums
**What goes wrong:** `addEnrichment` returns 403 on albums the user didn't create via this app.
**Why it happens:** Post-March 2025 API restriction — only app-created content is writable.
**How to avoid:** Document this constraint in the tool description. The handler should surface the 403 with a clear message.

### Pitfall 4: dateFilter.dates and dateFilter.ranges are mutually exclusive
**What goes wrong:** Sending both `dates` and `ranges` arrays returns a 400.
**How to avoid:** Zod `.refine()` check. Pick `dates` over `ranges` if both somehow appear (defensive).

### Pitfall 5: Sharing stub tools must appear in handleListTools
**What goes wrong:** If stub tools are only in `handleCallTool` but not `handleListTools`, the AI agent cannot discover them and FULL-01 is functionally unaddressed.
**How to avoid:** Add all four sharing stub tool definitions to `handleListTools` with descriptions stating they are deprecated.

---

## Code Examples

### Full ContentCategory enum (verified from official docs)
```typescript
// Source: https://developers.google.com/photos/library/reference/rest/v1/mediaItems/search
export const CONTENT_CATEGORIES = [
  'LANDSCAPES', 'RECEIPTS', 'CITYSCAPES', 'LANDMARKS', 'SELFIES', 'PEOPLE',
  'PETS', 'WEDDINGS', 'BIRTHDAYS', 'DOCUMENTS', 'TRAVEL', 'ANIMALS', 'FOOD',
  'SPORT', 'NIGHT', 'PERFORMANCES', 'WHITEBOARDS', 'SCREENSHOTS', 'UTILITY',
  'ARTS', 'CRAFTS', 'FASHION', 'HOUSES', 'GARDENS', 'FLOWERS', 'HOLIDAYS',
] as const;
```

Note: The existing `filterBuilder.ts` is missing: `RECEIPTS`, `WEDDINGS`, `BIRTHDAYS`, `SPORT`, `NIGHT`, `PERFORMANCES`, `WHITEBOARDS`, `ARTS`, `CRAFTS`, `FASHION`, `HOUSES`, `GARDENS`, `HOLIDAYS`. The new `search_media_by_filter` tool's enum should be the complete list.

### addEnrichment request body shape
```typescript
// Source: https://developers.google.com/photos/library/reference/rest/v1/albums/addEnrichment
// TextEnrichment
{ newEnrichmentItem: { textEnrichment: { text: 'Caption text' } }, albumPosition: { position: 'LAST_IN_ALBUM' } }

// LocationEnrichment
{ newEnrichmentItem: { locationEnrichment: { location: { locationName: 'Paris', latlng: { latitude: 48.8566, longitude: 2.3522 } } } }, albumPosition: { position: 'FIRST_IN_ALBUM' } }
```

### albums.patch for cover photo
```typescript
// Source: https://developers.google.com/photos/library/reference/rest/v1/albums/patch
// PATCH https://photoslibrary.googleapis.com/v1/albums/{album.id}?updateMask=coverPhotoMediaItemId
// Body: { "coverPhotoMediaItemId": "MEDIA_ITEM_ID" }
```

### orderBy for search (date-filtered searches only)
```typescript
// Source: https://developers.google.com/photos/library/reference/rest/v1/mediaItems/search
// orderBy only valid when dateFilter is present
{ filters: { dateFilter: { ... } }, orderBy: 'MediaMetadata.creation_time desc' }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `photoslibrary.sharing` scope for share/join/leave | Permanently removed | March 31, 2025 | FULL-01 can only be stubs |
| `photoslibrary` (full access) scope | Replaced by `photoslibrary.readonly.appcreateddata` + `photoslibrary.appendonly` + `photoslibrary.edit.appcreateddata` | March 31, 2025 | Cover photo patch needs a scope not yet in the auth flow |
| NLP query → filters in `search_photos` | Structured filter inputs in new `search_media_by_filter` tool | Phase 3 addition | Deterministic, AI-friendly filter construction |

**Deprecated/outdated:**
- `sharedAlbums.join`, `sharedAlbums.leave`, `sharedAlbums.list`, `sharedAlbums.get`: Removed March 31, 2025
- `albums.share`, `albums.unshare`: Removed March 31, 2025
- `photoslibrary.sharing` OAuth scope: No longer issuable or valid

---

## Open Questions

1. **Should `search_media_by_filter` replace or complement `search_photos`?**
   - What we know: `search_photos` does NLP → filter mapping; `search_media_by_filter` will accept structured inputs directly
   - What's unclear: Whether to deprecate `search_photos` or keep both for backward compatibility
   - Recommendation: Keep both. `search_photos` for freeform text queries; new tool for deterministic structured access.

2. **Does `photoslibrary.edit.appcreateddata` need explicit OAuth scope addition to the auth flow?**
   - What we know: Phase 2 added `photoslibrary.appendonly`. The patch endpoint requires `photoslibrary.edit.appcreateddata`.
   - Recommendation: Add `photoslibrary.edit.appcreateddata` to the OAuth scope array in the auth setup (alongside existing scopes) so re-auth grants it. Make `set_album_cover` handler emit a PERMISSION_DENIED re-auth prompt if 403 is received.

3. **Should `orderBy` be exposed in `search_media_by_filter`?**
   - What we know: `orderBy` is only valid when `dateFilter` is present; values are `MediaMetadata.creation_time` and `MediaMetadata.creation_time desc`.
   - Recommendation: Include it as an optional field with Zod refinement that rejects `orderBy` when no `dateFilter` is set.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.6 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=dot test/unit/albumsRepository.test.ts test/unit/mcpCore.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-04 | `search_media_by_filter` dispatches with date filter | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| READ-04 | `search_media_by_filter` dispatches with category filter | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| READ-04 | `searchPhotos` repository called with correct `SearchFilter` | unit | `npm test -- test/unit/photosRepository.test.ts` | ✅ extend |
| FULL-01 | `share_album` returns FEATURE_DEPRECATED error | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| FULL-01 | `join_shared_album` returns FEATURE_DEPRECATED error | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| FULL-02 | `add_album_enrichment` dispatches TextEnrichment correctly | unit | `npm test -- test/unit/albumsRepository.test.ts` | ❌ Wave 0 |
| FULL-02 | `add_album_enrichment` dispatches LocationEnrichment correctly | unit | `npm test -- test/unit/albumsRepository.test.ts` | ❌ Wave 0 |
| FULL-02 | `add_album_enrichment` returns 403 error message on non-app-created album | unit | `npm test -- test/unit/albumsRepository.test.ts` | ❌ Wave 0 |
| FULL-03 | `set_album_cover` calls `albums.patch` with `updateMask=coverPhotoMediaItemId` | unit | `npm test -- test/unit/albumsRepository.test.ts` | ❌ Wave 0 |
| FULL-03 | `set_album_cover` returns PERMISSION_DENIED re-auth prompt on 403 | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| FULL-04 | `search_media_by_filter` with date range + category builds correct SearchFilter | unit | `npm test -- test/unit/mcpCore.test.ts` | ❌ Wave 0 |
| FULL-04 | Zod schema rejects albumId + filters simultaneously | unit | `npm test -- test/unit/toolSchemas.test.ts` | ✅ extend |
| FULL-04 | Zod schema rejects dates + dateRanges simultaneously | unit | `npm test -- test/unit/toolSchemas.test.ts` | ✅ extend |

### Sampling Rate
- **Per task commit:** `npm test -- test/unit/albumsRepository.test.ts test/unit/mcpCore.test.ts test/unit/toolSchemas.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `test/unit/albumsRepository.test.ts` — covers FULL-02 (addEnrichment), FULL-03 (patchAlbum)
- [ ] Extend `test/unit/mcpCore.test.ts` — covers READ-04, FULL-01 stubs, FULL-03 403 path, FULL-04 dispatch
- [ ] Extend `test/unit/toolSchemas.test.ts` — covers new `searchMediaByFilterSchema`, `addEnrichmentSchema`, `setCoverPhotoSchema` validation rules
- [ ] Add `addEnrichment` and `patch` methods to `client.ts` mock shape in test helpers

---

## Sources

### Primary (HIGH confidence)
- Official docs: https://developers.google.com/photos/library/reference/rest/v1/mediaItems/search — SearchFilter shape, constraints, ContentCategory enum
- Official docs: https://developers.google.com/photos/library/reference/rest/v1/albums/addEnrichment — enrichment types and scopes
- Official docs: https://developers.google.com/photos/library/reference/rest/v1/albums/patch — patch endpoint, updateMask values, scope
- Official docs: https://developers.google.com/photos/support/updates — scope removals effective March 31, 2025
- Codebase: `src/api/types.ts` — existing SearchFilter definition
- Codebase: `src/api/client.ts` — existing HTTP client pattern
- Codebase: `src/api/search/filterBuilder.ts` — existing category mapping (incomplete)
- Codebase: `src/schemas/toolSchemas.ts` — Zod pattern to follow
- Codebase: `src/mcp/core.ts` — tool dispatch and handler pattern

### Secondary (MEDIUM confidence)
- WebSearch cross-reference: Google Photos sharing deprecation confirmed by multiple sources (GitHub issues, developer blogs) — sharing scope definitively removed

### Tertiary (LOW confidence)
- None — all critical claims verified against official sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, no new deps
- Architecture: HIGH — patterns consistent with established codebase conventions
- Pitfalls: HIGH — sharing deprecation confirmed via official docs; filter constraints from API spec
- Sharing endpoint status: HIGH — `photoslibrary.sharing` scope removal confirmed official

**Research date:** 2026-03-13
**Valid until:** 2026-06-13 (Google Photos API is now stable post-April 2025 changes)
