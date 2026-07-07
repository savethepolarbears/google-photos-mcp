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

None. All lint and type suppressions have been successfully refactored and resolved.

## 3. Debt Classification Table

| Item | Location(s) | Type | Evidence | Impact | Risk | Effort | Confidence | Recommended Fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| God Object Core | `src/mcp/core.ts` | Architecture / Complexity | File is 1,923 lines, tests are also very large (495 & 439 lines) | Dev Speed, Reliability | High | L | High | Refactor `mcp/core.ts` by splitting individual tools/handlers into separate modules under `src/mcp/tools/` or similar folder structure. |
| Monolithic Tests | `test/unit/toolSchemas.test.ts`, `test/unit/albumsRepository.test.ts` | Test Debt | Files are large (~400 LOC) and could be brittle | Dev Speed | Low | M | Med | Break down large unit test files by logical grouping or nested `describe` blocks in separate files to keep under 200-300 lines each. |

## 4. Top 2 "High ROI" Items

1. **Refactor `src/mcp/core.ts` (The God Object)**
   - *Why:* At ~1900 lines, this file is too complex and handles too many responsibilities. Splitting this up will drastically improve development speed, reduce merge conflicts, and make unit testing individual tools much simpler.

2. **Break Down `test/integration/mcpCore.test.ts`**
   - *Why:* As `mcp/core.ts` is split up, the integration tests should also be modularized. Smaller integration test suites make it easier to diagnose exactly which tool or flow failed in CI/CD.
