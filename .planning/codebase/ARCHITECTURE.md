# Architecture

This document describes the architectural patterns, layers, data flow, abstractions, and entry points of the Google Photos MCP server.

## 1. Architectural Patterns

The codebase follows a **Layered Architecture**, separating the presentation/interface layer (MCP protocol handling) from business logic, data access, and cross-cutting concerns. It also extensively utilizes the **Facade Pattern** (e.g., `src/api/photos.ts`) to provide a simplified interface to a complex subsystem of repositories and services. The **Template Method Pattern** is used in the server implementations, where a base class (`GooglePhotosMCPCore`) defines the skeleton of the MCP handlers, and subclasses (`GooglePhotosHTTPServer`, `GooglePhotosDXTServer`) implement specific transport or lifecycle details.

## 2. Layers

- **Presentation / Transport Layer (`src/index.ts`, `src/dxt-server.ts`)**: Handles the specific transport mechanisms (HTTP/SSE or STDIO) and application lifecycle, including graceful shutdown and server instantiation.
- **MCP Core Layer (`src/mcp/core.ts`)**: Defines the Model Context Protocol tools (e.g., `search_photos`, `list_albums`), validates incoming arguments using Zod schemas, manages quotas, and formats output data for the MCP client.
- **Service Layer (`src/api/services/`)**: Orchestrates complex business logic spanning multiple operations. For instance, `photoSearchService.ts` combines Google Photos API search with client-side token matching and location enrichment.
- **Repository Layer (`src/api/repositories/`)**: Encapsulates direct data access to the Google Photos API (e.g., `photosRepository.ts`, `albumsRepository.ts`). Responsibilities include setting up API requests and applying retry policies.
- **Domain / Utilities Layer (`src/api/search/`, `src/api/enrichment/`)**: Contains pure business logic for parsing search strings, building API filters, matching tokens, and fetching location metadata via Nominatim.
- **Infrastructure / Cross-Cutting Concerns**:
  - `src/auth/`: Manages OAuth2 flows, secure token storage in the OS keychain, and mutex-protected token refreshing.
  - `src/utils/`: Provides logging (Winston), configuration management, rate limiting, quota tracking, health checks, and retry mechanics.

## 3. Data Flow

1. **Client Request**: An MCP client sends a tool execution request (via STDIO or HTTP).
2. **Transport & Routing**: The transport layer passes the request to `GooglePhotosMCPCore.handleCallTool`.
3. **Authentication & Validation**: The core checks for valid tokens via `tokenRefreshManager.refreshIfNeeded()`, and validates arguments using schemas in `src/schemas/toolSchemas.ts`.
4. **Service Invocation**: The core calls the relevant service or repository function (e.g., `searchPhotosByText`).
5. **API Request**: The repository constructs the Google Photos API request, wrapped in a retry mechanism (`withRetry`), and sends it using the `google-auth-library` OAuth2 client.
6. **Enrichment**: If requested, the response data is enriched (e.g., `locationEnricher.ts` translates coordinates to location names).
7. **Formatting & Response**: The data bubbles back up to the MCP Core, which formats the `PhotoItem` models into MCP-compliant JSON representations and sends them back to the client.

## 4. Key Abstractions

- **`GooglePhotosMCPCore`**: Abstract base representing the MCP server logic, oblivious to the actual transport mechanism.
- **`TokenRefreshManager`**: A mutex-based abstraction preventing concurrent token refresh operations across multiple requests.
- **`PhotoItem` & `FormattedPhoto`**: Abstractions that normalize the Google Photos API response into a consistent internal model, separating the external API structure from the MCP output structure.

## 5. Entry Points

- **`src/index.ts`**: The main entry point supporting both HTTP/SSE mode (for web interaction and OAuth callbacks) and standard STDIO mode.
- **`src/dxt-server.ts`**: A specialized entry point for DXT mode, providing bounded execution (timeout management) over STDIO to prevent long-running tasks from hanging clients.
