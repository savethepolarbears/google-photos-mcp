# Directory Structure

## Root Layout
The workspace is structured as a standard Node.js/TypeScript project, organized into `src` for source code, `test` for tests, and standard configuration files at the root.

```
/
├── .env.example        # Environment variable template
├── .eslintrc.json      # ESLint configuration
├── package.json        # NPM dependencies and scripts
├── tsconfig.json       # TypeScript compiler configuration
├── vitest.config.ts    # Vitest testing configuration
├── src/                # Primary source code directory
├── test/               # Test suites (unit, integration, security)
├── docs/               # Project documentation
└── dist/               # Compiled JavaScript output
```

## Source Code (`src/`)
The `src/` directory is organized by feature and architectural layer:

*   **`src/index.ts`**: The main entry point for starting the HTTP and standard STDIO servers.
*   **`src/dxt-server.ts`**: An alternative entry point tailored for DXT clients, injecting execution timeouts.

### API Layer (`src/api/`)
Contains all logic for communicating with the Google Photos API.
*   `src/api/photos.ts`: The facade module re-exporting the API's public interface.
*   `src/api/client.ts`: Raw Axios HTTP client configuration and error mapping.
*   `src/api/oauth.ts`: OAuth client factory and credential management.
*   `src/api/types.ts`: Core TypeScript definitions for the Google Photos API domain.
*   **`src/api/repositories/`**: Contains direct CRUD operations (e.g., `albumsRepository.ts`, `photosRepository.ts`).
*   **`src/api/services/`**: Contains orchestration logic, like `photoSearchService.ts`.
*   **`src/api/search/`**: Contains modules for building filters (`filterBuilder.ts`) and post-processing search results (`tokenMatcher.ts`).
*   **`src/api/enrichment/`**: Contains location enrichment logic (`locationEnricher.ts`).

### Authentication (`src/auth/`)
Handles the OAuth 2.0 flow and token lifecycle.
*   `src/auth/routes.ts`: Express routes (`/auth`, `/oauth2callback`) for initial user authentication.
*   `src/auth/tokens.ts`: Interfaces for retrieving and saving tokens.
*   `src/auth/secureTokenStorage.ts`: Integration with `keytar` for OS-level secure credential storage.
*   `src/auth/tokenRefreshManager.ts`: Singleton managing token refresh logic to avoid race conditions.

### MCP Protocol (`src/mcp/`)
*   `src/mcp/core.ts`: Contains `GooglePhotosMCPCore`, which defines the tools available to Claude and dispatches incoming tool execution requests to the correct service/repository.

### Validation (`src/schemas/`)
*   `src/schemas/toolSchemas.ts`: Zod schemas defining the expected input arguments for every MCP tool (e.g., `searchPhotosSchema`).

### Utilities (`src/utils/`)
Cross-cutting concerns and shared helpers.
*   `logger.ts`: Winston-based logging, conditionally piping to stderr during STDIO mode.
*   `quotaManager.ts`: Tracks API usage against daily limits.
*   `healthCheck.ts`: Monitors the health of the API connection and token status.
*   `retry.ts`: Generic retry mechanism with exponential backoff.
*   `validation.ts`: Helper for executing Zod validations against tool arguments.
*   `nominatimRateLimiter.ts` & `location.ts`: Rate-limiting logic specifically for external geocoding services.

### Views (`src/views/`)
*   `src/views/index.html`: Static HTML served during the OAuth flow.

## Naming Conventions
*   **Files/Modules**: `camelCase` (e.g., `photoSearchService.ts`, `dxt-server.ts`).
*   **Classes/Interfaces**: `PascalCase` (e.g., `GooglePhotosMCPCore`, `PhotoItem`).
*   **Variables/Functions**: `camelCase` (e.g., `getAuthenticatedClient`, `quotaManager`).
*   **Tests**: Suffixed with `.test.ts` mirroring the source file name (e.g., `unit/photoSearchService.test.ts`).
*   **Constants**: Upper `SNAKE_CASE` for global constants (e.g., `DXT_TIMEOUT`).