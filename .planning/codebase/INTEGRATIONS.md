# External Integrations

## External APIs & Services

### 1. Google Photos API
- **Purpose**: Main data source for the MCP server. Enables fetching albums, searching for media items, and retrieving photo metadata.
- **Base URL**: `https://photoslibrary.googleapis.com/v1`
- **Implementation**: Uses `axios` with connection pooling (`https.Agent` keep-alive settings) for performance optimizations.
- **Key Capabilities**: 
  - `albums.list` / `albums.get`
  - `mediaItems.search` / `mediaItems.get`

### 2. OpenStreetMap / Nominatim API
- **Purpose**: Geocoding service used to enrich photo location data. It attempts to search for a location based on location names extracted from photo descriptions, since Google Photos API does not always expose precise location coordinates directly.
- **Base URL**: `https://nominatim.openstreetmap.org/search`
- **Implementation**: Free geocoding API accessed via `axios` and heavily rate-limited (1 request/second) via an internal `nominatimRateLimiter` to comply with Nominatim's strict usage policies. 

## Authentication & Authorization

### Google Cloud OAuth2
- **Purpose**: Securing access to user's Google Photos data.
- **Mechanism**: OAuth 2.0 flow using `google-auth-library` and `googleapis`.
- **Flow Details**: Uses Client ID, Client Secret, and a Redirect URI handled by an internal `express` server endpoint to acquire Access and Refresh tokens.
- **Scope Limitations**: Aware of Google's 2025 API scope deprecations (restricting some scopes to app-created content only) and provides customized error messaging.

## Local/System Integrations

### OS Keychain (via `keytar`)
- **Purpose**: Secure token storage.
- **Mechanism**: The application securely stores OAuth sensitive tokens (`access_token`, `refresh_token`, `id_token`) using the host operating system's native keychain (Keychain Access on macOS, Secret Service on Linux, Credential Vault on Windows) rather than plain-text files.
- **Metadata**: Non-sensitive token metadata (like `userId`, `userEmail`, timestamps) is stored alongside in `.google-photos-mcp/*.meta.json` files on the filesystem.
