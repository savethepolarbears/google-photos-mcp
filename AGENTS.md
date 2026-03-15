# Repository Guidelines

## Project Overview

MCP server exposing the Google Photos Library API and the Google Photos Picker API as tools for AI assistants (Claude, Gemini, Codex). Supports **read, write, and picker** operations over STDIO and Streamable HTTP transports.

## Project Structure & Module Organization

Source lives under `src/`, with `src/index.ts` as the HTTP entry point and `src/dxt-server.ts` as the DXT/STDIO entry point. Both delegate to `src/mcp/core.ts` which contains all tool handlers.

| Directory | Responsibility |
| --- | --- |
| `src/api/` | Google Photos API clients, repositories, types, search logic |
| `src/api/repositories/` | Low-level API calls (Library API + Picker API) |
| `src/auth/` | OAuth 2.0 flows, token storage (OS keychain), refresh management |
| `src/mcp/` | MCP core: tool definitions, handler dispatch, prompts, resources |
| `src/schemas/` | Zod schemas for tool argument validation |
| `src/utils/` | Config, logging, quota management, retry, location enrichment |
| `src/views/` | HTML templates (auth success/logout pages) |
| `test/` | Vitest tests: `unit/`, `integration/`, `security/` |
| `dist/` | Compiled JavaScript output (gitignored) |

## Build, Test, and Development Commands

```bash
npm install          # Install dependencies (required before first build)
npm run dev          # Dev mode with ts-node and live reload
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled HTTP server
npm run stdio        # Run compiled STDIO server
npm run lint         # ESLint check
npm run format       # Prettier format
npm test             # Run all tests (Vitest)
npm run test:watch   # Interactive TDD mode
npm run test:coverage # Coverage report
npm run test:security # Security tests only
npx tsc --noEmit     # Type-check without emitting
```

**All three checks must pass before merge**: `npx tsc --noEmit`, `npm run lint`, `npm test`.

## Coding Style & Naming Conventions

- **Module system**: ESM (`"type": "module"` in package.json), strict TypeScript
- **Formatting**: Prettier defaults — two-space indent, single quotes, trailing commas
- **Linting**: `eslint:recommended` + `@typescript-eslint/recommended`; prefer explicit return types
- **Files/directories**: kebab-case (`photo-repository.ts`)
- **Classes**: PascalCase (`GooglePhotosMCPCore`)
- **Functions/variables**: camelCase (`createPickerSession`)
- **Environment**: `.env` files mirroring `.env.example` keys

## Testing Guidelines

Vitest test runner. Tests live in `test/` with `*.test.ts` suffix:

- **Unit tests**: `test/unit/` — individual function behavior, Zod schema validation
- **Integration tests**: `test/integration/` — full tool request → response flow with mocked externals
- **Security tests**: `test/security/` — CORS, DNS rebinding, CSRF, JWT, file permissions

New features must include:

- Input validation tests (Zod schema compliance)
- Error handling tests (API failures, auth errors)
- Security tests for sensitive operations

## Architecture Decisions

- **Entry points never override base class handlers**. `dxt-server.ts` and `index.ts` call `super.registerHandlers()` and must not override `ListResourcesRequestSchema` or `ListPromptsRequestSchema`.
- **`uploadMedia` receives `albumId` directly** — items are added to the album at creation time. No separate `batchAddMediaItemsToAlbum` call needed in `create_album_with_media`.
- **`includeArchivedMedia` is a root-level filter boolean**, not a feature filter entry. The API rejects `INCLUDE_ARCHIVED` in `featureFilter`.
- **Picker API** (`create_picker_session` / `poll_picker_session`) uses a separate OAuth scope and REST endpoint (`photospicker.mediaitems.readonly`).

## Commit & Pull Request Guidelines

Concise, imperative commit subjects (e.g., `Fix album listing pagination`). Group related changes; avoid mixing refactors with features. PRs should outline intent, list changes, mention new env vars, and describe verification steps.

## Security & Configuration

- **Never commit** `.env`, OAuth credentials, or token files
- Request minimal Google Photos scopes when testing locally
- Rotate `tokens.json` entries on permission errors
- Document new scopes or callbacks in `README.md`

## Do-Not Rules

- ❌ Do not add CORS middleware (removed for security; see `.jules/sentinel.md`)
- ❌ Do not use `console.log` in STDIO mode — all output goes to stderr via the logger
- ❌ Do not add `any` types without an explanatory comment
- ❌ Do not bypass Zod validation for tool arguments
