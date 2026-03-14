# Phase 1: Foundation (Auth & Infrastructure) - Research

**Researched:** 2026-03-13
**Domain:** OAuth2 token lifecycle, quota management, exponential backoff, Winston logging — TypeScript/Node.js
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can securely authenticate via Google OAuth2 with `keyv` local token storage | Existing OAuth2 flow in `src/auth/routes.ts` is correct. Storage layer must be migrated from `keytar` to `keyv + @keyv/sqlite`. |
| AUTH-02 | System automatically refreshes OAuth tokens using a Mutex to prevent race conditions | `src/auth/tokenRefreshManager.ts` already implements promise-deduplication mutex. Needs verification that error paths clean up the map entry (they do — `finally` block). |
| INFR-01 | System precisely tracks the 10,000 requests/day API quota | `src/utils/quotaManager.ts` singleton exists, tracks requests + media bytes, resets at UTC midnight, throws `McpError` at limit. No gaps identified. |
| INFR-02 | System implements exponential backoff and retry for transient API failures | `src/utils/retry.ts` implements `withRetry` covering 5xx + 429 + network errors. 429 path uses 30s minimum delay. |
| INFR-03 | System provides detailed Winston-based logging for transparent agent debugging | `src/utils/logger.ts` is fully wired with file + console transports, STDIO mode writes to stderr to protect MCP protocol on stdout. |
</phase_requirements>

---

## Summary

Phase 1 infrastructure is **substantially pre-built** but contains one critical compliance gap: `secureTokenStorage.ts` uses `keytar` (deprecated, archived, requires native compilation) while AUTH-01 explicitly mandates `keyv`. All other Phase 1 components (`tokenRefreshManager`, `quotaManager`, `retry`, `logger`) are implemented and have passing vitest unit tests.

The migration from `keytar` to `keyv + @keyv/sqlite` is the primary implementation task. It requires replacing `secureTokenStorage.ts` with a `keyv`-backed store, updating `tokens.ts` to remove the `secureTokenStorage` abstraction in favor of direct keyv calls, and deleting the `migrateLegacyTokens` function (legacy tokens.json users are already migrated or nonexistent on a clean install). The `config.ts` `tokens.path` key should be repurposed to point at the SQLite database file instead of a JSON path.

A secondary task is the orphaned `test/tokens.test.ts` file — it uses the legacy `node:test` API (not vitest), imports a `getTokens` export that does not exist in the current `tokens.ts`, and is not being executed by the vitest runner. This file should be deleted and replaced with a vitest-compatible `test/unit/tokens.test.ts` covering AUTH-01 and AUTH-02 scenarios.

**Primary recommendation:** Replace `keytar` with `keyv + @keyv/sqlite`, delete `secureTokenStorage.ts`, update `tokens.ts` to wrap keyv directly, and author vitest unit tests for the new storage layer.

---

## Standard Stack

### Core (already installed)

| Library | Version in package.json | Purpose | Status |
|---------|--------------------------|---------|--------|
| `google-auth-library` | `^9.15.1` | OAuth2 client, token refresh | Installed. Note: STACK.md targets `^10.6.1` — minor upgrade acceptable but not blocking. |
| `googleapis` | `^144.0.0` | Google API client | Installed. STACK.md targets `^171.4.0` — minor upgrade acceptable. |
| `winston` | `^3.17.0` | Leveled logging | Installed and fully configured. |

### To Install (AUTH-01 gap)

| Library | Target Version | Purpose | Why |
|---------|---------------|---------|-----|
| `keyv` | `^5.6.0` | KV abstraction for token storage | AUTH-01 explicit mandate; pure-JS, no native deps |
| `@keyv/sqlite` | latest | SQLite adapter for keyv | Persistent, single-file, zero-config DB backend |

### To Remove (after migration)

| Library | Why |
|---------|-----|
| `keytar` | Deprecated, archived, native C++ — causes Docker/CI install failures |

### Installation

```bash
npm install keyv @keyv/sqlite
npm uninstall keytar
```

---

## Architecture Patterns

### Existing Structure (Phase 1 scope)

```
src/
├── auth/
│   ├── routes.ts              # OAuth2 HTTP flow (KEEP — no changes needed)
│   ├── tokens.ts              # Public API for token save/get (REFACTOR — remove keytar dependency)
│   ├── secureTokenStorage.ts  # keytar-backed impl (DELETE — replace with keyv)
│   └── tokenRefreshManager.ts # Mutex refresh (KEEP — already correct)
└── utils/
    ├── config.ts              # Env var loading (MINOR — repurpose tokens.path)
    ├── quotaManager.ts        # Quota singleton (KEEP — no changes)
    ├── retry.ts               # Exponential backoff (KEEP — no changes)
    └── logger.ts              # Winston (KEEP — no changes)
```

### Pattern 1: keyv Token Store

**What:** Replace `keytar.setPassword` / `keytar.getPassword` calls with a `Keyv` instance backed by `@keyv/sqlite`.
**When to use:** Everywhere `secureTokenStorage.ts` is currently called.
**Note:** `keyv` stores are plain JSON in SQLite — not OS-keychain encrypted. This is acceptable for a single-user local MCP server where the risk model is "protect against accidental plaintext exposure" rather than "multi-user OS-level secret isolation". Document this explicitly in code.

```typescript
// Source: keyv official docs — https://github.com/jaredwray/keyv
import Keyv from 'keyv';
import KeyvSqlite from '@keyv/sqlite';

const store = new Keyv({ store: new KeyvSqlite('sqlite://./tokens.db') });

await store.set('userId', JSON.stringify(tokenPayload));
const raw = await store.get('userId');
const tokens = raw ? JSON.parse(raw) : null;
```

### Pattern 2: Mutex via Promise Deduplication

**What:** `TokenRefreshManager` uses a `Map<userId, Promise<TokenData>>`. If a refresh for a userId is in-flight, new callers receive the same promise rather than triggering a second refresh.
**Status:** Already implemented and tested in `tokenRefreshManager.ts`. No changes required.

### Pattern 3: QuotaManager — check-then-record

**What:** Every API call site must call `quotaManager.checkQuota()` before the request and `quotaManager.recordRequest()` after success.
**Status:** Already implemented. Phase 2 repository layer must wire these two calls at every HTTP boundary.

### Anti-Patterns to Avoid

- **Do not store tokens in a `.json` file on disk.** The `migrateLegacyTokens` function explicitly created `tokens.json.backup-*` files — a known pitfall. keyv/SQLite avoids this entirely.
- **Do not log tokens at any log level.** Winston transports write to `combined.log` on disk. Never pass token strings into logger calls.
- **Do not call `keytar` after migration.** Remove the import entirely so there is no fallback path that could silently bypass the new store.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Key-value token persistence | Custom JSON file manager | `keyv + @keyv/sqlite` | Already handles serialization, concurrent access, TTL |
| Exponential backoff | Custom sleep loop | `withRetry` in `src/utils/retry.ts` | Already handles 5xx, 429, network errors with configurable delays |
| OAuth token refresh race | Mutex class | Promise deduplication in `TokenRefreshManager` | Already implemented and tested |
| Leveled logging | `console.log` wrappers | `winston` in `src/utils/logger.ts` | Already routes to files + stderr-safe STDIO mode |

**Key insight:** The only genuine implementation work in this phase is the keyv migration. Everything else is audit, test coverage, and cleanup.

---

## Common Pitfalls

### Pitfall 1: keytar Native Compilation Failures

**What goes wrong:** `npm install` or `npm ci` fails in Docker, CI, or after a Node.js major version upgrade with `node-gyp` errors because `keytar` requires building a native `.node` binary.
**Why it happens:** `keytar` is archived and has not published pre-built binaries for recent Node.js versions.
**How to avoid:** Remove `keytar` from `package.json` and complete the `keyv` migration before any CI pipeline runs against this branch.
**Warning signs:** `Error: Cannot find module '../build/Release/keytar.node'`

### Pitfall 2: Plaintext Token Backup Leaks

**What goes wrong:** The current `migrateLegacyTokens` function renames `tokens.json` to `tokens.json.backup-{timestamp}` — a plaintext file containing all OAuth tokens sits in the project root.
**Why it happens:** Migration code was a safety net, but backups are never cleaned up automatically.
**How to avoid:** After migrating to keyv, delete `migrateLegacyTokens` entirely. Add `tokens.json*` and `*.db` to `.gitignore`. The keyv SQLite file should also never be committed.

### Pitfall 3: Logger stdout Contamination in STDIO Mode

**What goes wrong:** Any `console.log` or Winston transport writing to `process.stdout` corrupts the MCP JSON-RPC framing on stdout.
**Why it happens:** STDIO MCP servers use stdout as the transport pipe. Any extra bytes break JSON parsing at the client.
**How to avoid:** `logger.ts` already routes all console output to `stderrLevels` in STDIO mode. Never add a `console.log` or `process.stdout.write` anywhere in Phase 1 code.
**Warning signs:** Claude Desktop reports "Invalid JSON" or MCP connection drops after server startup.

### Pitfall 4: QuotaManager State Not Persisted Across Restarts

**What goes wrong:** The `quotaManager` singleton holds `requestCount` in memory. If the process restarts, the counter resets to 0, allowing more than 10,000 requests/day if the server crashes and relaunches mid-day.
**Why it happens:** In-memory counter with no backing store.
**How to avoid:** For Phase 1, this is acceptable — the quota is a best-effort guard, not a hard enforcer. Document the limitation. If exact enforcement is needed, persist the counter to the keyv store with a TTL matching midnight UTC.
**Warning signs:** `429 Too Many Requests` from Google API despite `quotaManager.getStats()` showing headroom.

### Pitfall 5: Orphaned `test/tokens.test.ts`

**What goes wrong:** The `tokens.test.ts` in the root `test/` directory uses `node:test` (not vitest), imports a nonexistent `getTokens` export, and is never executed by `npm test`.
**Why it happens:** The file predates the vitest migration.
**How to avoid:** Delete the file as part of this phase and replace it with `test/unit/tokens.test.ts` using vitest.

---

## Code Examples

### keyv Store Initialization

```typescript
// Source: https://github.com/jaredwray/keyv — official README
import Keyv from 'keyv';
import KeyvSqlite from '@keyv/sqlite';

// Single shared instance (module-level singleton pattern matching quotaManager)
export const tokenStore = new Keyv({
  store: new KeyvSqlite(`sqlite://${config.tokens.dbPath}`),
  namespace: 'tokens',
});
```

### Save Tokens with keyv

```typescript
// Replaces keytar.setPassword
export async function saveTokens(userId: string, tokens: TokenData): Promise<void> {
  await tokenStore.set(userId, JSON.stringify(tokens));
  logger.info(`Saved tokens for user ${userId}`);
}
```

### Get Tokens with keyv

```typescript
// Replaces keytar.getPassword
export async function getTokens(userId: string): Promise<TokenData | null> {
  const raw = await tokenStore.get(userId);
  if (!raw) return null;
  return JSON.parse(raw) as TokenData;
}
```

### Quota Guard (existing pattern — Phase 2 will use this)

```typescript
// Pattern already established in quotaManager.ts — shown here for planner reference
quotaManager.checkQuota();          // throws McpError if over limit
const result = await apiCall();
quotaManager.recordRequest();       // increment counter on success
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` OS keychain | `keyv + @keyv/sqlite` | keytar archived ~2023 | Eliminates native compilation failures; removes OS keychain dependency |
| `tokens.json` plaintext | `keyv` SQLite | This phase | No backup leak files; structured key access |
| `node:test` in `test/tokens.test.ts` | `vitest` in `test/unit/*.test.ts` | Existing vitest migration | Consistent test runner, ESM support, mocking via `vi` |

**Deprecated/outdated in this codebase:**
- `keytar@^7.9.0`: Remove from `package.json.dependencies`.
- `test/tokens.test.ts`: Uses `node:test` runner, not vitest. Delete and replace.
- `src/auth/secureTokenStorage.ts`: Delete after keyv migration is complete.
- `config.tokens.path`: Rename config key to `tokens.dbPath` to reflect SQLite file path semantics.

---

## Open Questions

1. **keyv SQLite encryption**
   - What we know: `@keyv/sqlite` stores data in plaintext SQLite. `keytar` used OS keychain encryption.
   - What's unclear: AUTH-01 says "secure token storage" — does "secure" require encryption at rest or just "not plaintext JSON file"?
   - Recommendation: Treat SQLite + `0o600` file permissions as sufficient. The token is still encrypted in transit (HTTPS) and only readable by the OS user running the server. Document this explicitly in code comments. If stricter encryption is needed, `keyv-encrypted` can be layered on top.

2. **`config.tokens.path` path traversal guard**
   - What we know: `validateTokenStoragePath` currently validates a JSON file path. Repurposing it for a SQLite path requires verifying the same traversal guard logic works for `.db` extensions.
   - Recommendation: The guard uses `path.relative` + `..` prefix check — it is path-agnostic and will work unchanged. No code change needed beyond renaming the env var.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^3.0.6` |
| Config file | `vitest.config.ts` (or inline in `package.json` — check) |
| Quick run command | `npx vitest run test/unit/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | `saveTokens` persists tokens via keyv; `getTokens` retrieves them | unit | `npx vitest run test/unit/tokens.test.ts` | Wave 0 |
| AUTH-01 | `getFirstAvailableTokens` returns most-recently-saved user | unit | `npx vitest run test/unit/tokens.test.ts` | Wave 0 |
| AUTH-01 | No plaintext backup files created after save | unit | `npx vitest run test/unit/tokens.test.ts` | Wave 0 |
| AUTH-02 | Concurrent refresh calls deduplicate to one `refreshAccessToken` invocation | unit | `npx vitest run test/unit/tokenRefreshManager.test.ts` | Already exists |
| AUTH-02 | Valid (non-expired) token skips refresh | unit | `npx vitest run test/unit/tokenRefreshManager.test.ts` | Already exists |
| AUTH-02 | Refresh failure cleans up mutex map entry (no stuck locks) | unit | `npx vitest run test/unit/tokenRefreshManager.test.ts` | Already exists |
| INFR-01 | `checkQuota` throws McpError at 10,000 requests | unit | `npx vitest run test/unit/quotaManager.test.ts` | Already exists |
| INFR-01 | `recordRequest` increments counter; 80% threshold logs warn | unit | `npx vitest run test/unit/quotaManager.test.ts` | Already exists |
| INFR-01 | Counter resets after UTC midnight | unit | `npx vitest run test/unit/quotaManager.test.ts` | Already exists |
| INFR-02 | `withRetry` retries 5xx errors with exponential backoff | unit | `npx vitest run test/unit/retry.test.ts` | Already exists |
| INFR-02 | `withRetry` does not retry 4xx non-429 errors | unit | `npx vitest run test/unit/retry.test.ts` | Already exists |
| INFR-02 | `withRetry` exhausts retries and re-throws last error | unit | `npx vitest run test/unit/retry.test.ts` | Already exists |
| INFR-03 | Logger writes to `error.log` and `combined.log` in non-test mode | unit | `npx vitest run test/unit/` | Manual-only (file transport side-effect) |
| INFR-03 | Logger routes console output to stderr in STDIO mode | unit | `npx vitest run test/unit/` | Manual-only |

### Sampling Rate

- **Per task commit:** `npx vitest run test/unit/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green (164+ tests passing) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `test/unit/tokens.test.ts` — covers AUTH-01: keyv save/get, `getFirstAvailableTokens`, no-backup-file assertion. Delete `test/tokens.test.ts` (legacy node:test) first.

*(All other Phase 1 test files already exist and pass.)*

---

## Sources

### Primary (HIGH confidence)
- Codebase scan: `src/auth/`, `src/utils/` — all files read directly
- `package.json` — dependency versions verified
- `npx vitest run` — 164 tests passing confirmed live
- `.planning/research/STACK.md` — keytar deprecation rationale
- `.planning/research/PITFALLS.md` — token backup leak, logger stdout contamination

### Secondary (MEDIUM confidence)
- keyv official README (https://github.com/jaredwray/keyv) — API surface for `set`/`get`
- `.planning/research/ARCHITECTURE.md` — layered structure and component responsibilities

### Tertiary (LOW confidence — not verified against live docs)
- keytar archived status — cited in STACK.md; not re-verified against GitHub today

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All files read directly from codebase; vitest suite confirmed passing |
| Architecture | HIGH | Existing code matches planned architecture exactly; gaps are additive not structural |
| Pitfalls | HIGH | Identified from direct code inspection (keytar dep, orphaned test file, backup leak) |
| Test map | HIGH | Test files enumerated by directory listing; pass/fail status verified by running suite |

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable domain; keyv and google-auth-library are mature)
