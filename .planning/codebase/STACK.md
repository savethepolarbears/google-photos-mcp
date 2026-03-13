# Technology Stack

## Languages and Runtimes
- **Language**: TypeScript
- **Runtime**: Node.js
- **Module System**: ESM (`"type": "module"`)

## Core Frameworks & Libraries
- **MCP Framework**: `@modelcontextprotocol/sdk` - Used for Model Context Protocol server implementation.
- **Web Server**: `express` - Used for handling OAuth callbacks and potentially HTTP-based MCP transport.

## Dependencies
### API & Networking
- `axios` - HTTP client used for interacting with the Google Photos API and Nominatim geocoding service.
- `google-auth-library`, `googleapis` - Google Cloud OAuth2 authentication and API access.

### Data Validation & Storage
- `zod` - Used for schema validation (e.g., input validation, tool schemas).
- `keytar` - Secure token storage using the native OS keychain.

### Utilities
- `dotenv` - Environment variable configuration.
- `winston` - Used for structured logging.

## Development & Testing
- **Compiler**: `typescript` (`tsc`), `ts-node` (for execution in dev mode).
- **Testing**: `vitest` (unit and integration tests), `supertest` (for testing Express routes).
- **Code Quality**: `eslint` (linting), `prettier` (formatting).

## Configuration
- `package.json` - Defines build, dev, lint, format, and test scripts.
- `tsconfig.json` - TypeScript compiler options.
- `.env` - Environment configurations for HTTP Server (`PORT`), Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`), MCP metadata, and logging (`LOG_LEVEL`).
- `.google-photos-mcp/` - Directory for storing non-sensitive user metadata as JSON (associated with securely stored keychain tokens).
