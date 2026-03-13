# Testing Patterns

## Framework & Configuration
* **Test Runner:** Vitest (`vitest run`, `vitest:watch`)
* **Environment:** Node.js
* **Globals:** Enabled in config (`import { describe, it, expect } from 'vitest'` is used explicitly in files, though globals are technically set to true).

## Directory Structure
* **Unit Tests:** `test/unit/` (e.g., `client.test.ts`, `tokenMatcher.test.ts`)
* **Integration Tests:** `test/integration/`
* **Security Tests:** `test/security/`
* **Helpers & Mocks:** `test/helpers/` (e.g., `mocks.ts`, `factories.ts`)

## File Naming
* Test files follow the `*.test.ts` naming convention.

## Mocking Strategy
* **Factory Pattern for Mocks:** A shared mock factory approach is used to keep test files clean. Functions like `createMockAxiosError` and `createMockNetworkError` are exported from `test/helpers/mocks.ts` to simulate external dependency behaviors consistently.
* **External Services:** HTTP calls (Axios) are generally mocked out rather than hitting live APIs.

## Coverage Requirements
* **Provider:** v8
* **Thresholds:** strict limits defined in `vitest.config.ts`:
  * Lines: 80%
  * Functions: 80%
  * Statements: 80%
  * Branches: 70%
* Excludes core entry points (`src/index.ts`, `src/dxt-server.ts`, types, views) from coverage metrics.

## Assertions
* Standard Vitest assertions are utilized: `expect(result).toBeInstanceOf(Error)`, `expect(result.message).toContain('...')`, `expect(result).not.toContain('...')`.
