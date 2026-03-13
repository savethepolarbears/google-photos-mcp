# External Integrations

## 1. Google Cloud & Google Photos API

- **Type**: External REST API & Authentication Provider
- **Purpose**: The core data provider for the server. Handles OAuth 2.0 flow and fetches user photos, albums, and media items.
- **Authentication**: OAuth 2.0 (Authorization Code Flow) requiring client ID and secret.
- **Scopes**: Requires `https://www.googleapis.com/auth/photoslibrary.readonly`.
- **Implementation**: Utilizes `google-auth-library` for authentication flows and token refreshing, and `axios` to execute raw requests against the Google Photos API endpoints (working around specific API deprecations where the official client might lack support).

## 2. Nominatim (OpenStreetMap)

- **Type**: External REST API
- **Purpose**: Geocoding and reverse-geocoding for photo locations. Converts geographic coordinates (latitude/longitude) from photo metadata into human-readable locations, or vice versa for location-based search filtering.
- **Endpoint**: `https://nominatim.openstreetmap.org/search`
- **Constraints & Implementation**: Due to OSM's strict usage policy, the integration implements a custom `NominatimRateLimiter` (`src/utils/nominatimRateLimiter.ts`) to strictly throttle requests to a maximum of 1 request per second. Uses `axios` for HTTP calls.

## 3. Model Context Protocol (MCP)

- **Type**: IPC / Tooling Protocol
- **Purpose**: Exposes the local Google Photos capabilities to LLM clients (like Claude or Cursor).
- **Implementation**: Uses `@modelcontextprotocol/sdk` to act as an MCP Server over `stdio`, defining various photo and album retrieval tools that the LLM can invoke.

## 4. System Keychain (via Keytar)

- **Type**: Local OS Integration
- **Purpose**: Secure credential storage.
- **Implementation**: Instead of keeping long-lived refresh tokens in plain text or standard configuration files, the server uses the `keytar` library to store and retrieve the user's Google OAuth refresh tokens directly within the host operating system's native keychain/credential manager. Fallback file-based token storage (`tokens.json`) is also supported.
