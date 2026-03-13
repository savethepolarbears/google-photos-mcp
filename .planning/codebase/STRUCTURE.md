# Project Structure

This document outlines the directory layout, key locations, and naming conventions for the Google Photos MCP server codebase.

## 1. Directory Layout

The workspace is organized into a standard Node.js/TypeScript structure:

```text
/Users/klkro/mcp-servers/google-photos/
├── src/                    # Source code root
│   ├── api/                # Google Photos API integration
│   │   ├── enrichment/     # Location data enrichment (Nominatim)
│   │   ├── repositories/   # CRUD operations for photos and albums
│   │   ├── search/         # Search parsing, token matching, and filter builders
│   │   ├── services/       # High-level orchestration and business logic
│   │   ├── __tests__/      # API-specific tests
│   │   ├── client.ts       # HTTP client and error handling wrapper
│   │   ├── oauth.ts        # OAuth client setup
│   │   ├── photos.ts       # Facade module re-exporting API functionalities
│   │   └── types.ts        # API-specific TypeScript interfaces
│   ├── auth/               # Authentication and token management
│   │   ├── routes.ts       # Express routes for OAuth callbacks
│   │   ├── secureTokenStorage.ts # OS keychain integration for tokens
│   │   ├── tokenRefreshManager.ts # Mutex-based token refresher
│   │   └── tokens.ts       # Token data interfaces and accessors
│   ├── mcp/                # Model Context Protocol implementation
│   │   └── core.ts         # Shared MCP tool definitions and handlers
│   ├── schemas/            # Zod validation schemas
│   │   └── toolSchemas.ts  # Input validation schemas for MCP tools
│   ├── types/              # Global TypeScript declarations
│   │   └── mcp.d.ts        # MCP SDK type augmentations
│   ├── utils/              # Cross-cutting utilities
│   │   ├── config.ts       # Environment variable parsing
│   │   ├── googleUser.ts   # User info extraction
│   │   ├── healthCheck.ts  # System health monitoring
│   │   ├── location.ts     # Geocoding utilities
│   │   ├── logger.ts       # Winston logger setup
│   │   ├── nominatimRateLimiter.ts # API rate limiting
│   │   ├── quotaManager.ts # Google API quota tracking
│   │   ├── retry.ts        # Exponential backoff utility
│   │   └── validation.ts   # Argument validation wrapper
│   ├── views/              # HTML views (e.g., for the HTTP server homepage)
│   ├── index.ts            # Main entry point (HTTP & standard STDIO)
│   └── dxt-server.ts       # Alternative entry point (DXT STDIO with timeouts)
├── test/                   # Test suite root
│   ├── helpers/            # Test factories and mocks
│   ├── integration/        # End-to-end and integration tests
│   ├── security/           # Security and vulnerability tests
│   └── unit/               # Unit tests matching the src/ structure
├── docs/                   # Project documentation
├── dist/                   # Compiled JavaScript output
└── .planning/              # Agent planning and architectural context
```

## 2. Key Locations

- **Tool Implementations**: Added or modified in `src/mcp/core.ts`, with input schemas in `src/schemas/toolSchemas.ts`.
- **API Endpoints**: Modified via `src/api/repositories/` and orchestrated via `src/api/services/`. The entry point for the rest of the application is the facade `src/api/photos.ts`.
- **Server Bootstrapping**: Managed in `src/index.ts` (Express and normal STDIO) and `src/dxt-server.ts` (timeout-wrapped STDIO).
- **Authentication**: Handled primarily within `src/auth/` using secure OS keychain storage and automated refresh mechanisms.

## 3. Naming Conventions

- **Files and Directories**: `camelCase` is used for files and directories (e.g., `photoSearchService.ts`, `secureTokenStorage.ts`). Exceptions include root configuration files (`tsconfig.json`, `package.json`), documentation (`README.md`, `ARCHITECTURE.md`), and the main server files.
- **Classes**: `PascalCase` is used for class names (e.g., `GooglePhotosMCPCore`, `TokenRefreshManager`).
- **Functions and Variables**: `camelCase` is used for functions, methods, and variables (e.g., `searchPhotosByText`, `getFirstAvailableTokens`).
- **Tests**: Test files append `.test.ts` to the module name being tested (e.g., `photosRepository.test.ts`).
- **Interfaces/Types**: `PascalCase` is used for types and interfaces (e.g., `PhotoItem`, `FormattedPhoto`).