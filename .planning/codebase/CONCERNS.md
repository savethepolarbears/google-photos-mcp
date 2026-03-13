# Codebase Concerns & Technical Debt

This document outlines the current technical debt, known bugs, security/performance issues, and fragile areas in the Google Photos MCP codebase.

## 1. Critical API Limitations
**Location:** `docs/API_LIMITATION.md`
**Type:** API/Functionality
- **Issue:** Google deprecated the `photoslibrary.readonly` scope for full library access (effective March 31, 2025). The app is currently limited to only fetching/searching content *created by this app itself*.
- **Impact:** The server is functionally broken for its primary expected use case: browsing a user's existing Google Photos library. The only viable path forward is migrating to the Google Photos Picker API, which requires a fundamentally different architectural approach (user interaction).

## 2. In-Memory Quota Tracking
**Location:** `src/utils/quotaManager.ts`
**Type:** Performance/Reliability
- **Issue:** The `QuotaManager` class stores request counts (`requestCount`) and media bytes (`mediaByteCount`) in local memory variables.
- **Impact:** Server restarts (which happen frequently with MCP servers) reset the quota counters to 0. This makes it incredibly easy to silently exceed Google's strict 10k requests/day and 75k media bytes/day limits, potentially leading to API bans or extended rate-limiting.

## 3. Unbounded Nominatim Rate Limiter Queue
**Location:** `src/utils/nominatimRateLimiter.ts`
**Type:** Performance/Memory Leak Risk
- **Issue:** The `NominatimRateLimiter` enforces a 1 request/sec limit and stores pending requests in an unbounded array (`requestQueue: Array<() => void>`).
- **Impact:** Bulk location enrichment (e.g., fetching locations for an album with thousands of photos) will queue thousands of requests. This will cause memory bloat and block process resolution for hours, with no built-in mechanism to timeout, reject, or prioritize requests in the queue.

## 4. Date Parsing Regex Bug (Pre-2000s Excluded)
**Location:** `src/api/search/filterBuilder.ts` (line ~51)
**Type:** Bug
- **Issue:** The regex logic for extracting years from natural language queries strictly enforces the pattern `/\b(20\d{2})\b/g`.
- **Impact:** Hardcodes the recognized years to 2000-2099. Any attempts to filter photos taken in 1999 or earlier will completely fail and be silently ignored by the filter builder.

## 5. Deprecated `keytar` Dependency
**Location:** `src/auth/secureTokenStorage.ts`, `package.json`
**Type:** Technical Debt / Security Risk
- **Issue:** The app uses `keytar` (`^7.9.0`) for OS-level keychain secure token storage.
- **Impact:** The `keytar` library has been officially deprecated and archived by its maintainers (Atom/GitHub). Continuing to use it relies on unmaintained native Node.js bindings, posing a significant risk of failing to build or run on future Node.js versions or OS updates.

## 6. Unhandled Promise Rejections in Test Suite
**Location:** `test/unit/retry.test.ts`
**Type:** Testing/Quality Debt
- **Issue:** Running `npm test` produces 4 Unhandled Promise Rejections (e.g., `ERR_BAD_REQUEST`, `ERR_BAD_RESPONSE`).
- **Impact:** The mocks in the retry tests reject promises before the test framework correctly handles them, leaking the errors to the global process. This creates console spam, hides true failures, and can cause CI pipelines to fail erratically.

## 7. Entrypoint Fragmentation (STDIO vs DXT)
**Location:** `src/index.ts` vs `src/dxt-server.ts`
**Type:** Architectural Debt
- **Issue:** `src/index.ts` contains an `--stdio` argument mode that connects `GooglePhotosMCPCore` directly to stdio. Meanwhile, `src/dxt-server.ts` does exactly the same thing but wraps all requests in a 30-second timeout (`GooglePhotosDXTServer`).
- **Impact:** Creates fragmentation. Clients using `index.ts --stdio` bypass the timeout protection introduced in `dxt-server.ts`. Bug fixes or features added to one stdio wrapper must be replicated in the other.

## 8. Missing Observability & Tracing
**Location:** `docs/REFACTORING_ROADMAP.md`
**Type:** Operational Debt
- **Issue:** The refactoring roadmap identifies several uncompleted "nice-to-haves" for observability: missing structured logging with request correlation IDs, no p50/p95 latency tracking, and lack of OpenTelemetry distributed tracing.
- **Impact:** Without correlation IDs, debugging complex multi-step failures in production (e.g., across token refreshes and multiple API calls) remains tedious and difficult.
