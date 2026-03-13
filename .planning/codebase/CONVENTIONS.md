# Codebase Conventions

## 1. Code Style and Formatting

- **TypeScript:** Strict mode is enabled (`strict: true`). Avoid `any`; use `unknown` if type is truly unknown, or define explicit types.
- **Modules:** Node ESM (ECMAScript Modules) format. Imports must use `.js` extension (e.g., `import { logger } from './logger.js'`).
- **Linter & Formatter:** Uses ESLint with `@typescript-eslint/recommended` and Prettier for code formatting. (Single quotes, trailing commas depending on Prettier defaults, typically double quotes for JSON and single quotes for TS/JS).
- **Documentation:** Use JSDoc format for all exported functions, classes, and interfaces. Comments should describe the purpose, parameters (`@param`), and return value (`@returns`).

## 2. Naming Conventions

- **Variables and Functions:** `camelCase` (e.g., `getPhotoClient`, `listAlbums`).
- **Classes and Interfaces:** `PascalCase` (e.g., `GooglePhotosMCPCore`, `PhotoItem`).
- **Interfaces:** Do not use the `I` prefix (use `Album` instead of `IAlbum`).
- **Response Types:** Types representing API responses should generally end with `Response` (e.g., `AlbumsListResponse`, `MediaItemResponse`).

## 3. Architectural Patterns

- **Dependency Injection:** External clients (like `OAuth2Client`) are passed into service and repository functions rather than being instantiated globally. This enables easier mocking and testing.
- **Factory Pattern:** Used to create configured instances, such as `createPhotosLibraryClient` for wrapping API calls.
- **Singletons:** State-holding utilities (like `logger`, `quotaManager`, `tokenRefreshManager`) are exported as singleton instances.
- **MCP Tool Handlers:** Tool arguments are validated using Zod schemas (`validateArgs`) before processing. Each MCP tool routes to a dedicated private handler method within the `GooglePhotosMCPCore` class.

## 4. Error Handling

- **Centralized Error Parsing:** The `toError` wrapper (in `src/api/client.ts`) converts unknown errors into standardized `Error` objects, specifically extracting nested `AxiosError` details and API-specific HTTP status codes.
- **API Errors:** The codebase handles specific Google Photos API restrictions (e.g., 2025 scope deprecations) within the unified error handler.
- **MCP Errors:** Protocol-level errors are thrown using the SDK's `McpError` (e.g., `ErrorCode.MethodNotFound`) to comply with the MCP specification.
