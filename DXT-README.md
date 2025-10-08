# Google Photos Desktop Extension (DXT)

A Desktop Extension (DXT) that enables Claude and other AI applications to search and interact with your Google Photos library through the Model Context Protocol (MCP).

## Features

- **Photo Search**: Search photos by content, keywords, dates, and locations
- **Album Management**: List and browse photo albums
- **Photo Details**: Get detailed information about specific photos including metadata
- **Location Data**: Access location information for photos when available
- **Base64 Export**: Optionally retrieve photos as base64-encoded data
- **Pagination Support**: Handle large photo collections efficiently

## Installation

### Option 1: Install as DXT Extension (Recommended)

1. **Download or Build the Extension**:
   ```bash
   # Clone the repository
   git clone <repository-url>
   cd google-photos-mcp
   
   # Install dependencies and build
   npm install
   npm run build
   ```

2. **Authenticate with Google Photos**:
   ```bash
   # Start the authentication server
   npm start
   
   # Visit http://localhost:3000/auth in your browser
   # Complete the Google OAuth flow
   # Tokens will be saved for the extension to use
   ```

3. **Package the Extension** (if building from source):
   ```bash
   npm run package-dxt
   ```

4. **Install in your AI application** that supports DXT extensions

### Option 2: Manual MCP Server Setup

1. **Build and Configure**:
   ```bash
   npm install
   npm run build
   ```

2. **Authenticate** (same as above)

3. **Add to Claude Desktop** or other MCP-compatible applications:
   ```json
   {
     "mcpServers": {
       "google-photos": {
         "command": "node",
         "args": ["/path/to/google-photos-mcp/dist/index.js", "--dxt"],
         "env": {}
       }
     }
   }
   ```

## Authentication Setup

**IMPORTANT**: You must authenticate with Google Photos before using this extension.

### Step-by-Step Authentication

1. **Start the HTTP server**:
   ```bash
   npm start
   ```

2. **Open your browser** and visit: `http://localhost:3000/auth`

3. **Complete OAuth flow**:
   - Click "Authenticate with Google Photos"
   - Log in to your Google account
   - Grant permissions to access your Google Photos
   - You'll see a success message when complete

4. **Verify authentication**:
   ```bash
   # Test with DXT mode
   npm run dxt
   # Or test with regular STDIO mode
   npm run stdio
   ```

5. **Stop the HTTP server** (Ctrl+C) and the extension is ready to use

## Available Tools

### `auth_status`
Check current authentication status with Google Photos.

### `search_photos`
Search for photos based on text queries.
- `query` (required): Search query (e.g., "vacation 2023", "sunset photos", "cats")
- `pageSize` (optional): Number of results (1-100, default: 25)
- `pageToken` (optional): Token for pagination
- `includeLocation` (optional): Include location data (default: true)

### `search_photos_by_location`
Search for photos based on location name.
- `locationName` (required): Location to search (e.g., "Paris", "New York")
- `pageSize` (optional): Number of results (1-100, default: 25)
- `pageToken` (optional): Token for pagination

### `get_photo`
Get details of a specific photo by ID.
- `photoId` (required): ID of the photo to retrieve
- `includeBase64` (optional): Include base64-encoded image data (default: false)
- `includeLocation` (optional): Include location data (default: true)

### `list_albums`
List all photo albums.
- `pageSize` (optional): Number of results (1-100, default: 20)
- `pageToken` (optional): Token for pagination

### `get_album`
Get details of a specific album by ID.
- `albumId` (required): ID of the album to retrieve

### `list_album_photos`
List photos in a specific album.
- `albumId` (required): ID of the album
- `pageSize` (optional): Number of results (1-100, default: 25)
- `pageToken` (optional): Token for pagination
- `includeLocation` (optional): Include location data (default: true)

## Usage Examples

### Basic Photo Search
```
Search for vacation photos from 2023
```

### Location-Based Search
```
Find photos taken in Tokyo
```

### Album Browsing
```
List my photo albums
```

### Photo Details
```
Show me details about this photo (when you have a photo ID)
```

## Technical Details

### DXT Compliance
- Follows DXT specification v0.1
- Implements proper timeout management (30 seconds)
- Includes comprehensive error handling
- Supports all required MCP protocol methods
- Provides structured JSON responses

### Error Handling
- Authentication errors with clear instructions
- Timeout protection for long-running operations
- Proper parameter validation
- Graceful degradation when services are unavailable

### Security Features
- OAuth2 authentication flow
- Local token storage
- No credentials stored in extension
- Secure API communication with Google Photos

## Troubleshooting

### Authentication Issues
- Ensure you've completed the OAuth flow at `http://localhost:3000/auth`
- Check that `tokens.json` exists and contains valid tokens
- Try re-authenticating if tokens are expired

### Connection Issues
- Verify your internet connection
- Check that Google Photos API is accessible
- Ensure the extension has proper permissions

### Extension Not Working
- Rebuild the extension: `npm run build`
- Check logs for specific error messages
- Verify the extension is properly installed in your AI application

## Development

### Building from Source
```bash
git clone <repository-url>
cd google-photos-mcp
npm install
npm run build
```

### Running in Development Mode
```bash
# HTTP mode for authentication
npm start

# DXT mode for testing
npm run dxt

# STDIO mode for Claude Desktop
npm run stdio
```

### Testing
```bash
# Build and test authentication
npm run build
npm start
# Visit http://localhost:3000/auth

# Test DXT mode
npm run dxt
```

## Requirements

- Node.js >= 18.0.0
- Google Photos account
- Internet connection for authentication and API calls

## License

MIT License - see LICENSE file for details.

## Support

For issues and feature requests, please use the project's issue tracker.