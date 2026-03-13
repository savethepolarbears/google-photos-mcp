# Codebase Concerns & Technical Debt

This document outlines technical debt, known bugs, security considerations, performance issues, and fragile areas in the codebase.

## 1. Critical Known Issues

### Google Photos API Limitation (Deprecation)

- **Status:** CRITICAL
- **Description:** As of March 31, 2025, Google deprecated full library access via the `https://www.googleapis.com/auth/photoslibrary.readonly` scope.
- **Impact:** The current MCP server can only access photos and albums created by this specific application. It cannot read the user's full Google Photos library, fundamentally limiting the core value proposition of the tool.
- **Remediation:** Requires a significant architectural rewrite to use the **Google Photos Picker API** (which requires user interaction) instead of the current library API.
- **Reference:** `docs/API_LIMITATION.md` and `src/api/client.ts`.

## 2. Technical Debt & Code Quality

### TypeScript Strictness

- **Description:** The `tsconfig.json` explicitly sets `"noImplicitAny": false`.
- **Impact:** This compromises the type safety of the project and contradicts claims in `docs/REFACTORING_ROADMAP.md` that all `any` types were fixed.
- **Remediation:** Enable `"noImplicitAny": true` in `tsconfig.json` and resolve resulting type errors to ensure a robust type system.

### Incomplete Observability

- **Description:** While basic health checks and quota managers exist, advanced telemetry is missing.
- **Impact:** Harder to debug performance issues or trace requests across the system.
- **Remediation:** Implement structured logging with request correlation IDs, latency tracking (p50/p95/p99), and OpenTelemetry for distributed tracing (as outlined in `REFACTORING_ROADMAP.md`).

### Test Coverage Gaps

- **Description:** Missing comprehensive integration tests against a mocked Google Photos API and edge cases for location parsing.
- **Impact:** Risk of unhandled edge cases in production, especially for complex features like location extraction.

## 3. Fragile Areas

### Location Data Extraction

- **Description:** Location data is "approximate and extracted from photo descriptions" since the Google Photos API does not provide exact GPS coordinates directly.
- **Impact:** Location-based searches (`search_photos_by_location`) heavily rely on Nominatim rate-limiting and the presence of text-based location data in descriptions, which is inherently fragile and unreliable.

### Graceful Shutdown Flaws

- **Description:** Global error handlers (`uncaughtException` and `unhandledRejection` in `src/index.ts`) immediately call `process.exit(1)`.
- **Impact:** Bypasses graceful shutdown logic (e.g., `httpServer.shutdown()`), which means active connections or pending cleanups (like `authCleanup`) are abruptly terminated.

## 4. Security Considerations

### Plaintext Token Backups

- **Description:** While OAuth tokens were migrated to OS keychain storage (`keytar`), the migration logic creates plaintext backups like `tokens.json.backup-*`.
- **Impact:** These backups subvert the security benefits of the OS keychain and could expose sensitive OAuth credentials if the file system is compromised or backed up insecurely.
- **Remediation:** Ensure secure deletion or encryption of backup token files, rather than leaving plaintext files on disk.

## 5. Performance

### HTTP Client Pooling

- **Description:** The `axios` instance in `src/api/client.ts` uses an HTTPS agent with keep-alive enabled.
- **Note:** This is a good optimization, but developers should ensure `maxSockets` (50) and timeouts align well with the expected concurrent MCP tool calls and Google's API limits to prevent connection starvation under heavy parallel loads.
