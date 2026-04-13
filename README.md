# Google Photos MCP Server

A Model Context Protocol (MCP) server for Google Photos integration, enabling Claude, Gemini, and other AI assistants to **read, write, and pick** photos from your Google Photos library.

## ✅ Picker API Support (March 2025+)

This server implements the **Google Photos Picker API**, providing full library access even after the March 31, 2025 deprecation of certain Library API scopes.

| Capability | Status | API |
| --- | --- | --- |
| Browse full photo library | ✅ | Picker API |
| Search photos by text/date/category | ✅ | Library API |
| Create albums & upload photos | ✅ | Library API |
| Access app-created content | ✅ | Library API |

### How the Picker API works

1. Call `create_picker_session` — returns a URL the user opens in their browser
2. User selects photos from their full library
3. Call `poll_picker_session` — when `mediaItemsSet` is true, selected photos are returned

## 🛡️ Security Notice: CORS Removed

CORS middleware has been removed for security (prevents drive-by attacks on localhost).

- ✅ **STDIO mode** (Claude Desktop): Works normally
- ✅ **Streamable HTTP** (Cursor, server-to-server): Works normally
- ❌ **Browser AJAX**: Not supported (by design)

## Features

### Read operations

- Search photos by text, date, location, category, favorites
- Filter by media type (photo/video), date ranges, archived status
- Get photo details including base64-encoded images
- List albums and their contents
- Describe available filter capabilities

### Write operations

- Create albums and upload photos
- Batch upload with `create_album_with_media` (up to 50 files)
- Add text and location enrichments to albums
- Set album cover photos

### Picker operations

- Create picker sessions for full library access
- Poll sessions and retrieve selected media items

### Infrastructure

- ⚡ Streamable HTTP transport (MCP 2025-06-18 spec)
- 🔗 HTTPS Keep-Alive with connection pooling
- 🔒 OS keychain token storage
- 📊 Quota management with automatic tracking
- 🔄 Automatic token refresh

## Prerequisites

- Node.js 22.22+
- Google Cloud project with **Photos Library API** enabled
- OAuth 2.0 credentials (Web application type)

## Setup

### 1. Google Cloud setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Photos Library API**
4. Create OAuth 2.0 credentials (Web application)
5. Add `http://localhost:3000/auth/callback` as an authorized redirect URI
6. Note your Client ID and Client Secret

### 2. Installation

```bash
git clone https://github.com/savethepolarbears/google-photos-mcp.git
cd google-photos-mcp
npm install
```

### 3. Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
NODE_ENV=development
```

### 4. Build & run

```bash
npm run build    # Compile TypeScript
npm start        # HTTP mode (for auth & Cursor)
npm run stdio    # STDIO mode (for Claude Desktop)
npm run dev      # Dev mode with live reload
```

### 5. Authenticate

1. Start in HTTP mode: `npm start`
2. Visit `http://localhost:3000/auth` in your browser
3. Complete the Google OAuth flow
4. Tokens are saved automatically to the OS keychain

> **Note**: Authentication must be completed in HTTP mode first. After that, switch to STDIO mode for Claude Desktop.

### Dynamic port

```bash
PORT=3001 npm start
# Also update GOOGLE_REDIRECT_URI in .env to match
```

## Client configuration

### Claude Desktop (STDIO)

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "node",
      "args": ["/path/to/google-photos-mcp/dist/index.js", "--stdio"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3000/auth/callback"
      }
    }
  }
}
```

### Cursor IDE

**STDIO** (recommended):

- Type: Command
- Command: `node /path/to/google-photos-mcp/dist/index.js --stdio`

**HTTP**:

- Type: URL
- URL: `http://localhost:3000/mcp`

### Smithery

```bash
# Claude Desktop
npx -y @smithery/cli install google-photos-mcp --client claude

# Cursor IDE
npx -y @smithery/cli install google-photos-mcp --client cursor
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js        # HTTP
npx @modelcontextprotocol/inspector node dist/index.js --stdio # STDIO
```

## Available tools (19)

### Search & browse

| Tool | Description |
| --- | --- |
| `search_photos` | Text-based photo search |
| `search_photos_by_location` | Search by location name |
| `search_media_by_filter` | Filter by dates, categories, media type, favorites, archived |
| `get_photo` | Get photo details (optional base64) |
| `list_albums` | List all albums |
| `get_album` | Get album details |
| `list_album_photos` | List photos in an album |
| `list_media_items` | List all media items |
| `describe_filter_capabilities` | JSON reference of all filter options |

### Write & manage

| Tool | Description |
| --- | --- |
| `create_album` | Create a new album |
| `upload_media` | Upload a local file |
| `add_media_to_album` | Add existing items to an album (max 50) |
| `create_album_with_media` | Create album + upload files in one call (max 50) |
| `add_album_enrichment` | Add text or location enrichment |
| `set_album_cover` | Set album cover photo |

### Picker API

| Tool | Description |
| --- | --- |
| `create_picker_session` | Start a Picker session for full library access |
| `poll_picker_session` | Check session status and retrieve selected photos |

### Auth

| Tool | Description |
| --- | --- |
| `auth_status` | Check authentication status |
| `start_auth` | Start OAuth flow via temporary local server |

## Example queries

```text
"Show me photos from my trip to Paris"
"Find photos of my dog from 2024"
"List my photo albums"
"Upload these vacation photos to a new album called 'Summer 2025'"
"Search for landscape photos from last year, ordered newest first"
"Let me pick some photos from my library" (triggers Picker API)
```

## Location data

Location data is approximate, extracted from photo descriptions using OpenStreetMap/Nominatim geocoding. When available, includes latitude/longitude, city, region, country.

## Deployment / release

This project is a Model Context Protocol (MCP) server intended to be run locally alongside AI clients like Claude Desktop or Cursor. There is no remote deployment or release process required beyond keeping your local checkout or NPM installation up to date.

## Troubleshooting

- **Node Version**: Ensure you are using Node.js 22.22+ as older versions are not supported.
- **Authentication**: If you encounter `GOOGLE_CLIENT_ID is not set` errors or authentication fails, verify your `.env` file is present in the root directory and contains your correct Google Cloud credentials. Remember to run `npm start` (HTTP mode) to authenticate before switching to STDIO mode.
- **Quota Issues**: Google Photos API limits apply. Ensure you aren't hitting the 10,000 requests/day quota limit. The server tracks this via `quotaManager`.
- **CORS Errors**: The server intentionally disables CORS to prevent drive-by attacks. Do not attempt to call the server directly from browser AJAX requests.

## Development

### Project structure

```text
src/
├── index.ts              # HTTP entry point
├── dxt-server.ts         # STDIO/DXT entry point
├── mcp/core.ts           # All tool handlers (19 tools)
├── api/
│   ├── client.ts         # REST client (Library + Picker)
│   ├── photos.ts         # Facade module (re-exports)
│   ├── types.ts          # TypeScript interfaces
│   └── repositories/     # Low-level API calls
├── auth/                 # OAuth, tokens, keychain
├── schemas/              # Zod validation schemas
├── utils/                # Config, logging, quota, retry
└── views/                # HTML templates
```

### Testing

```bash
npm test              # All tests (Vitest)
npm run test:watch    # Interactive TDD
npm run test:coverage # Coverage report
npm run test:security # Security suite only
```

### Quality checks

All three must pass before merge:

```bash
npx tsc --noEmit   # Type check
npm run lint        # ESLint
npm test            # Tests
```

## License

MIT
