# Tech Stack

## Languages & Runtime

- **Language**: TypeScript (target ES2022)
- **Runtime**: Node.js (via `ts-node` for dev, compiled via `tsc` for production)

## Frameworks & Core Libraries

- **@modelcontextprotocol/sdk** (^1.27.1): Core framework to expose Google Photos tools as an MCP (Model Context Protocol) server.
- **Express** (^5.2.1): Lightweight web server used to handle the Google OAuth callback redirect (`/auth/callback`).
- **Axios** (^1.13.6): HTTP client used for interacting with external REST APIs (specifically Google Photos API and OpenStreetMap Nominatim).
- **Google API Libraries**:
  - `google-auth-library` (^10.6.1): OAuth 2.0 implementation.
  - `googleapis` (^171.4.0): Core Google API client.
- **Keytar** (^7.9.0): Secure system keychain integration to store OAuth tokens locally.
- **Zod** (^4.3.6): Schema validation for input parsing and type-safety.
- **Winston** (^3.19.0): Comprehensive logging framework.
- **Dotenv** (^17.3.1): Environment variable management.

## Development & Testing

- **TypeScript & Build**: `typescript`, `ts-node`
- **Testing**:
  - `vitest`: Fast, modern testing framework (unit, integration, and security tests).
  - `@vitest/coverage-v8`: Test coverage reporting.
  - `supertest`: HTTP assertions for the Express OAuth routes.
- **Linting & Formatting**:
  - `eslint` & `@typescript-eslint/*`: Code linting.
  - `prettier`: Code formatting.
  - `markdownlint-cli2`: Markdown file linting.

## Configuration & Tooling

- **`package.json`**: NPM dependencies and script definitions (`build`, `start`, `dev`, `lint`, `test`, `stdio`).
- **`tsconfig.json`**: TypeScript compiler configuration (NodeNext module resolution, Strict mode enabled).
- **`.env.example`**: Environment template defining required variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `PORT`, etc.).
- **`smithery.yaml`**: Server definition metadata used to register the MCP integration with Smithery.
