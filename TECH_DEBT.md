# Technical Debt Register

## 1. Snapshot Baseline Metrics

- **Lines of Code (LOC):** ~10,400 (src and test combined)
- **Dependency Count:** 10 runtime, 13 dev (23 total)
- **Build Time:** ~5.5s (tsc)
- **Test Time:** ~5.0s (Vitest)
- **Bundle Size:** N/A (Server-side Node.js application)

## 2. Identified Debt Hotspots

### The "Big File" List (Top By Size)

1. `src/mcp/core.ts` (1,923 lines) - Centralized MCP tool logic.
2. `test/integration/mcpCore.test.ts` (495 lines)
3. `test/unit/mcpCore.test.ts` (439 lines)
4. `test/unit/toolSchemas.test.ts` (398 lines)
5. `test/unit/albumsRepository.test.ts` (379 lines)
6. `src/api/repositories/photosRepository.ts` (350 lines)

### Lint & Type Suppressions

- `src/api/repositories/photosRepository.ts` (`// eslint-disable-next-line @typescript-eslint/no-explicit-any`)
- `test/unit/quotaManager.test.ts` (`// eslint-disable-next-line @typescript-eslint/no-explicit-any`)
- `src/utils/logger.ts` (`// @ts-expect-error - express-winston expects a stream-compatible interface`)
- `test/unit/tokens.test.ts` (`// @ts-expect-error — getTokens does not exist yet; RED state until Plan 02`)

## 3. Debt Classification Table

| Item | Location(s) | Type | Evidence | Impact | Risk | Effort | Confidence | Recommended Fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| God Object Core | `src/mcp/core.ts` | Architecture / Complexity | File is 1,923 lines, tests are also very large (495 & 439 lines) | Dev Speed, Reliability | High | L | High | Refactor `mcp/core.ts` by splitting individual tools/handlers into separate modules under `src/mcp/tools/` or similar folder structure. |
| Red State Test | `test/unit/tokens.test.ts` | Test Debt | `@ts-expect-error` specifically referencing "RED state until Plan 02" | Dev Speed | Low | S | High | Complete "Plan 02" implementation for `getTokens` or remove the failing test expectation if the feature is abandoned. |
| Any Type Usage | `src/api/repositories/photosRepository.ts`, `test/unit/quotaManager.test.ts` | Type Debt | `eslint-disable-next-line @typescript-eslint/no-explicit-any` | Reliability | Low | S | High | Replace `any` with specific types, interfaces, or `unknown` combined with runtime validation. |
| Logger Typing | `src/utils/logger.ts` | Type / Lib Debt | `@ts-expect-error - express-winston expects a stream-compatible interface` | Reliability | Low | S | Med | Investigate exact `express-winston` typing requirements; create a custom wrapper or adapter that satisfies the stream interface. |
| Monolithic Tests | `test/unit/toolSchemas.test.ts`, `test/unit/albumsRepository.test.ts` | Test Debt | Files are large (~400 LOC) and could be brittle | Dev Speed | Low | M | Med | Break down large unit test files by logical grouping or nested `describe` blocks in separate files to keep under 200-300 lines each. |

## 4. Top 5 "High ROI" Items

1. **Refactor `src/mcp/core.ts` (The God Object)**
   - *Why:* At ~1900 lines, this file is too complex and handles too many responsibilities. Splitting this up will drastically improve development speed, reduce merge conflicts, and make unit testing individual tools much simpler.

2. **Fix `getTokens` Red State (`test/unit/tokens.test.ts`)**
   - *Why:* A known red state or incomplete test setup introduces unverified code paths. Completing this ensures authentication/token behavior is fully tested and robust.

3. **Eliminate `any` in `photosRepository.ts`**
   - *Why:* Core data access logic should be strongly typed. Using `any` in the repository layer bypasses TypeScript's safety, potentially allowing runtime errors to slip through from the API boundaries.

4. **Break Down `test/integration/mcpCore.test.ts`**
   - *Why:* As `mcp/core.ts` is split up, the integration tests should also be modularized. Smaller integration test suites make it easier to diagnose exactly which tool or flow failed in CI/CD.

5. **Resolve Logger Stream Typings (`src/utils/logger.ts`)**
   - *Why:* While minor, fixing type suppressions on fundamental utilities like logging prevents future regressions if the underlying library updates. Writing an explicit stream adapter improves overall type safety.
