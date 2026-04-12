# Repository Guidelines & AI Agent Instructions

This is a **PUBLIC** open-source repository.

## ⚠️ STRICT CONSTRAINTS (MUST READ)

1. **NO SECRETS:** Ensure no tokens, credentials, or `.env` files are accidentally generated or preserved in commits.
2. **VERIFICATION-FIRST:** Because we do not use GitHub Actions or automated workflows (due to cost), ALL testing and verification MUST be performed locally by the agent before ANY commit is made.
3. **DOCUMENTATION EXCELLENCE:** All documentation must be rock solid, cleanly linted (MD013 disabled, but MD022/MD032 strict), and highly functional.
4. **NO BROKEN COMMITS:** A commit must not be pushed if `npm run lint`, `npm run build`, or `npm test` are failing. Period.

---

## 🚀 Essential Commands

These are the canonical commands derived from the repository configuration. All verification checks must pass before pushing any commits.

```bash
npm install           # Install dependencies
npm run dev           # Dev mode with live reload (ts-node)
npm run build         # Compile TypeScript to dist/
npm start             # Run compiled HTTP server
npm run stdio         # Run compiled STDIO server
npx tsc --noEmit      # Type-check without emitting (MUST PASS)
npm run lint          # ESLint check (MUST PASS)
npm test              # Run all tests via Vitest (MUST PASS)
npm run test:watch    # Interactive TDD mode
npm run test:coverage # Coverage report
npm run test:security # Security tests only
```

---

## 🏗️ Project Overview & Architecture

**Google Photos MCP Server** is a Model Context Protocol (MCP) server exposing the Google Photos Library API and the Google Photos Picker API as tools for AI assistants (Claude, Gemini, etc.).

### Architecture Rules

1. **Transport Layers**: The server supports both STDIO (for Claude Desktop) and Streamable HTTP (for Cursor and other clients).
2. **Entry Points**: `src/index.ts` (HTTP) and `src/dxt-server.ts` (STDIO/DXT).
   - **Crucial Rule**: Entry points call `super.registerHandlers()` and **must not override** `ListResourcesRequestSchema` or `ListPromptsRequestSchema`.
3. **Tool Handlers**: All tool logic is centralized in `src/mcp/core.ts`. Tool arguments are strictly validated using Zod schemas (`src/schemas/toolSchemas.js`).
4. **API Integration**:
   - Low-level Google Photos API calls are in `src/api/repositories/`.
   - The Picker API (`create_picker_session` / `poll_picker_session`) uses a separate OAuth scope (`photospicker.mediaitems.readonly`) and REST endpoints.
   - **`uploadMedia` Rule**: It receives `albumId` directly—items are added to the album at creation time. No separate `batchAddMediaItemsToAlbum` call needed in `create_album_with_media`.
   - **Filter Rule**: `includeArchivedMedia` is a root-level filter boolean, not a feature filter entry. The API rejects `INCLUDE_ARCHIVED` in `featureFilter`.
5. **Security**: CORS middleware has been removed for security (to prevent drive-by attacks on localhost). The local Express server uses an `allowedHosts` array for DNS rebinding protection (`127.0.0.1` and `[::1]`). Do not add CORS back.

---

## 🛠️ Tech Stack & Details

- **Language**: TypeScript 5.9+ (Strict Mode)
- **Runtime**: Node.js 22.22+
- **Package Manager**: npm 11.11+
- **Frameworks/Libs**: Express 5.2+, @modelcontextprotocol/sdk 1.27+, Zod 3.25+, Vitest 3.2+
- **Module System**: ESM (`"type": "module"` in package.json)

---

## 📁 Repository Map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | HTTP Server Entry point (Streamable HTTP) |
| `src/dxt-server.ts` | STDIO/DXT Entry point |
| `src/mcp/core.ts` | All MCP tool definitions, handlers, prompts, and resources |
| `src/api/` | Google Photos API clients, facades, and search logic |
| `src/api/repositories/` | Low-level API REST calls (Library API + Picker API) |
| `src/auth/` | OAuth flows, local token storage (keychain), and refresh management |
| `src/schemas/` | Zod schemas for all tool argument validation |
| `src/utils/` | Config, quota tracking, logging, retry logic |
| `src/views/` | HTML templates for OAuth success/failure |
| `test/` | Vitest suites (`unit/`, `integration/`, `security/`, `helpers/`) |
| `dist/` | Compiled JavaScript output |

---

## 💻 Coding Conventions

1. **Imports**: Use `.js` extensions for local imports (ESM requirement).
2. **Formatting**: Prettier defaults (2-space indent, single quotes, trailing commas).
3. **Linting**: No `@typescript-eslint/no-explicit-any` without an explanatory comment (`// eslint-disable-next-line ...`).
4. **Naming**:
   - Files: `kebab-case.ts`
   - Classes: `PascalCase`
   - Functions/Vars: `camelCase`
5. **Validation**: NEVER bypass Zod validation for tool arguments.
6. **Logging**: Do not use `console.log` in STDIO mode (it breaks the MCP protocol). Use the established `logger` which writes to stderr.

---

## 🚫 Agent Boundaries & DO-NOT Rules

- ❌ **NO CORS**: Do not add CORS middleware. It was intentionally removed.
- ❌ **NO SECRETS**: Never commit `.env` files, OAuth credentials, or token files.
- ❌ **NO ENTRY POINT OVERRIDES**: Do not override base class handler registrations in entry points.
- ❌ **NO ANY TYPES**: Do not use `any` types without explicit inline justifications.
- ❌ **NO BROWSER AJAX SUPPORT**: It is intentionally unsupported.

---

## 🧪 PR & Review Expectations

1. **Validation Checks**: `npm run lint`, `npx tsc --noEmit`, and `npm test` **MUST** all pass.
2. **Test Coverage**:
   - New features require: Zod validation tests, error handling tests, and integration tests.
   - Touching sensitive operations (auth, files, tokens) requires updating/adding tests in `test/security/`.
3. **Commit Messages**: Use concise, imperative commit subjects (e.g., `Fix album listing pagination`). Group related changes and do not mix refactors with features.

---

## 💡 Environment Gotchas & Notes

- **Auth Dependency**: Authentication must be completed in HTTP mode first (`npm start`). Switch to STDIO mode (`npm run stdio`) only after tokens are acquired.
- **Quota Management**: The project tracks Google Photos API quotas. Respect the `quotaManager` limits.
- **Tokens**: Stored securely via OS keychain (`keytar` dependency via `src/auth/secureTokenStorage.ts`).
