# Codebase Conventions

## Tech Stack & Tooling
* **Language:** TypeScript
* **Module System:** ES Modules (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`)
* **Linting:** ESLint (`@typescript-eslint/recommended`)
* **Formatting:** Prettier
* **Validation:** Zod for runtime schema validation (`src/schemas/toolSchemas.ts`, `src/utils/validation.ts`)

## Code Organization & Architecture
* **Facade Pattern:** The API layer uses a facade module (`src/api/photos.ts`) that re-exports functionality from focused sub-modules (e.g., `oauth.ts`, `client.ts`, `repositories/`, `services/`, `search/`).
* **HTTP Client:** Uses `axios` with customized `https.Agent` for keep-alive and connection reuse to optimize performance.
* **Separation of Concerns:** Clear separation between API wrapper (`client.ts`), token management (`auth/`), and specific features (e.g., `search/`, `enrichment/`).
* **MCP Integration:** Core MCP logic is separated in `src/mcp/core.ts` and `src/dxt-server.ts`.

## Naming Conventions
* **Files:** camelCase for TypeScript files (`photoSearchService.ts`, `albumsRepository.ts`).
* **Variables & Functions:** camelCase.
* **Types/Interfaces:** PascalCase (`AlbumsListResponse`, `MediaItemResponse`).

## Error Handling
* **Standardization:** Centralized error normalization using the `toError` helper function (`src/api/client.ts`).
* **Axios Errors:** Wraps Axios errors, attaching status codes and API context.
* **Contextual Context:** Enriches specific errors, such as providing context on the 2025 API scope deprecations for `PERMISSION_DENIED` errors.
* **Typing:** Returns standard `Error` instances avoiding string/null panics.

## Logging
* **Library:** Winston logger (`src/utils/logger.ts`).
* **Environment Aware:** When the application runs in STDIO mode (for MCP via `--stdio`), console output is automatically redirected to `stderr` to avoid interfering with the JSON-RPC over `stdout`.
* **File Transport:** Logs are simultaneously written to local files (`error.log`, `combined.log`).
