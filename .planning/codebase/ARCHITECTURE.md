# Architecture Overview

## Architectural Patterns
The Google Photos MCP Server follows a modular, layered architecture designed for separation of concerns and robust error handling. The primary patterns employed are:

1.  **Facade Pattern**: `src/api/photos.ts` acts as a unified facade, aggregating and re-exporting functionalities from `repositories`, `services`, and `search` modules. This hides internal complexity from the MCP layer.
2.  **Inheritance / Polymorphism**: The core MCP logic is abstracted into `GooglePhotosMCPCore` (`src/mcp/core.ts`). Specific deployment targets inherit from this:
    *   `GooglePhotosHTTPServer` (`src/index.ts`): Adds Express routes, SSE transport, and DNS rebinding protections.
    *   `GooglePhotosDXTServer` (`src/dxt-server.ts`): Adds STDIO transport with a protective timeout wrapper around tool executions.
3.  **Singleton Managers**: Components requiring state across the application lifecycle (e.g., `quotaManager`, `tokenRefreshManager`, `healthChecker`) are implemented as singletons.
4.  **Adapter Pattern**: The raw Axios calls are wrapped by a factory function `getPhotoClient` (`src/api/client.ts`), providing a domain-specific, type-safe API interface.

## Layers
1.  **Entry/Transport Layer (`src/index.ts`, `src/dxt-server.ts`)**
    *   Handles process initialization, configures environment (HTTP vs. STDIO), sets up Express for OAuth flows, and binds MCP transports.
2.  **Protocol/MCP Layer (`src/mcp/core.ts`)**
    *   Defines tools (`search_photos`, `get_album`, etc.), validates incoming requests using Zod schemas, and orchestrates calls to the API layer.
3.  **Auth & Security Layer (`src/auth/`)**
    *   Manages OAuth 2.0 flow, secure token storage (`keytar`), and automatic token refreshing to ensure uninterrupted API access.
4.  **Service/Orchestration Layer (`src/api/services/`)**
    *   Handles complex business logic. For example, `searchPhotosByText` combines upstream API calls with client-side keyword filtering and location matching.
5.  **Repository Layer (`src/api/repositories/`)**
    *   Focused strictly on CRUD operations against the Google Photos API (e.g., `albumsRepository`, `photosRepository`).
6.  **Utility & Infrastructure Layer (`src/utils/`)**
    *   Provides cross-cutting concerns: Winston logging, quota tracking, health checks, rate limiting, and retry mechanisms.

## Data Flow
**Incoming Request (Tool Execution):**
1.  The client (e.g., Claude) sends a JSON-RPC request over STDIO or HTTP (SSE).
2.  The Transport passes it to `GooglePhotosMCPCore.handleCallTool`.
3.  The request arguments are validated against predefined Zod schemas (`src/schemas/toolSchemas.ts`).
4.  `quotaManager.checkQuota()` verifies rate limits.
5.  `tokenRefreshManager` ensures a valid access token is available.
6.  The handler calls the relevant Service or Repository method.
7.  The Service processes the request, optionally using `filterBuilder` to create API queries, then calls the Repository.
8.  The Repository uses `photosApi` (Axios) to make the HTTP request to `photoslibrary.googleapis.com`.
9.  The Google Photos API responds.
10. The Service may post-process the data (e.g., `tokenMatcher` filters results client-side).
11. The result is formatted in `GooglePhotosMCPCore` and returned as a JSON string to the MCP Client.

## Key Abstractions
*   **`GooglePhotosMCPCore`**: Base class encapsulating tool definitions and standard MCP handlers.
*   **`createPhotosLibraryClient`**: Type-safe wrapper abstracting Axios HTTP interactions.
*   **`TokenRefreshManager`**: Abstracts the complexity of token expiration, preventing concurrent refresh race conditions.
*   **`QuotaManager`**: Abstracts the Google API daily limits, tracking standard requests and expensive base64 image fetches separately.

## Entry Points
*   **`node dist/index.js`**: Starts the HTTP Server (useful for the OAuth flow and SSE transport).
*   **`node dist/index.js --stdio`**: Starts the standard STDIO server for Claude Desktop integration.
*   **`node dist/dxt-server.js`**: Starts the DXT-specific STDIO server which includes 30-second execution timeouts.