# CLAUDE.md — Project Instructions for Claude Code

## Quick Context

MCP server for Google Photos (Library API + Picker API). TypeScript, ESM, strict mode. Two entry points: `src/index.ts` (HTTP) and `src/dxt-server.ts` (STDIO/DXT). All tool logic centralized in `src/mcp/core.ts`.

## Essential Commands

```bash
npx tsc --noEmit     # Type-check (must pass)
npm run lint         # ESLint (must pass)
npm test             # Vitest suite (must pass)
npm run dev          # Dev mode with live reload
npm run build        # Compile to dist/
```

All three checks (`tsc`, `lint`, `test`) must be green before any commit.

## Architecture Quick Reference

| Layer | Path | Role |
| --- | --- | --- |
| Entry (HTTP) | `src/index.ts` | Express server, Streamable HTTP transport |
| Entry (STDIO) | `src/dxt-server.ts` | DXT/STDIO transport |
| Core | `src/mcp/core.ts` | All 19 tool definitions, handler dispatch, prompts, resources |
| API Client | `src/api/client.ts` | Google Photos REST client + Picker API client |
| Repository | `src/api/repositories/` | Low-level API calls |
| Schemas | `src/schemas/toolSchemas.ts` | Zod validation for tool arguments |
| Config | `src/utils/config.ts` | OAuth scopes, Google Cloud settings |

## Key Architecture Rules

1. **Entry points call `super.registerHandlers()`** — never override `ListResourcesRequestSchema` or `ListPromptsRequestSchema` (this was a destructive bug).
2. **`uploadMedia` receives `albumId` directly** — items join the album at creation. No separate `batchAddMediaItemsToAlbum` needed in `create_album_with_media`.
3. **`includeArchivedMedia` is a root-level filter boolean** — do not put `INCLUDE_ARCHIVED` in `featureFilter` (Google rejects it).
4. **Picker API** uses scope `photospicker.mediaitems.readonly` and separate REST endpoints under `https://photospicker.googleapis.com/v1/`.

## Available Tools (19 total)

**Read**: `auth_status`, `search_photos`, `search_photos_by_location`, `search_media_by_filter`, `get_photo`, `list_albums`, `get_album`, `list_album_photos`, `list_media_items`, `describe_filter_capabilities`

**Write**: `create_album`, `upload_media`, `add_media_to_album`, `create_album_with_media`, `add_album_enrichment`, `set_album_cover`

**Picker**: `create_picker_session`, `poll_picker_session`

**Auth**: `start_auth`

## Coding Conventions

- ESM imports with `.js` extensions (TypeScript compiles to ESM)
- Prettier: 2-space indent, single quotes, trailing commas
- kebab-case files, PascalCase classes, camelCase functions
- No `console.log` in STDIO mode — use `logger` (stderr)
- No `any` without explanatory comment
- All tool arguments validated via Zod schemas

## Do-Not Rules

- ❌ Do not add CORS middleware (removed for security)
- ❌ Do not override base class handler registration in entry points
- ❌ Do not bypass Zod validation for tool arguments
- ❌ Do not commit `.env`, OAuth credentials, or token files

## Test Structure

```text
test/
├── unit/          # Function-level tests, schema validation
├── integration/   # Full tool request → response with mocked externals
├── security/      # CORS, DNS rebinding, CSRF, JWT, file perms
└── helpers/       # Test factories and utilities
```

New features require: input validation tests, error handling tests, and security tests when touching sensitive operations.
