# Testing Patterns

## 1. Framework and Tooling

- **Test Runner:** [Vitest](https://vitest.dev/) is used as the test runner with the `node` environment.
- **Global API:** Vitest globals are enabled, so `describe`, `it`, `expect`, `beforeEach`, and `vi` can be used directly or imported from `vitest`.
- **Scripts:**
  - Run all tests: `npm run test`
  - Watch mode: `npm run test:watch`
  - Coverage: `npm run test:coverage`
  - Security tests: `npm run test:security`

## 2. Directory Structure

Tests are isolated from the main `src` directory and structured logically inside `/test/`:

- `test/unit/`: Unit tests for individual components, modules, and repositories.
- `test/integration/`: Tests checking the interactions between components (e.g., `mcpCore.test.ts`).
- `test/security/`: Dedicated security tests.
- `test/helpers/`: Shared utilities, data factories, and mock builders.

**Naming convention:** Test files are named `[subject].test.ts` matching the file they test.

## 3. Mocking Strategy

- **Module Mocks:** `vi.mock()` is heavily used to stub out internal dependencies, utilities (like `logger`, `retry`), and external APIs.
- **Mock Helpers:** The `test/helpers/mocks.ts` file provides functions to instantiate complex mock objects, such as `createMockAxiosError` or `createMockNetworkError`.
- **Data Factories:** `test/helpers/factories.ts` provides factory functions (`createMockPhotoItem`, `createMockAlbum`) to generate predictable, customizable data payloads for tests, eliminating boilerplate in individual tests.
- **State Reset:** Tests use `beforeEach(() => { vi.clearAllMocks(); })` to ensure mock call histories do not leak between assertions.

## 4. Test Coverage

- **Provider:** Coverage is gathered using Vitest's `v8` provider.
- **Thresholds:** The project enforces strict code coverage thresholds defined in `vitest.config.ts`:
  - **Lines:** 80%
  - **Functions:** 80%
  - **Statements:** 80%
  - **Branches:** 70%
- **Exclusions:** Entry points (`src/index.ts`, `src/dxt-server.ts`), types (`src/types/**`), and view templates are excluded from coverage calculations.
