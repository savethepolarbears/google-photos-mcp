# Google Photos MCP Server

A Model Context Protocol (MCP) server for Google Photos integration, allowing Claude and other AI assistants to access and work with your Google Photos library.

## Features

- Search photos by content, date, location
- Get location data for photos (approximate, based on descriptions)
- Fetch specific photos by ID
- List albums and photo collections
- Works with Claude Desktop, Cursor IDE, and other MCP-compatible clients through the MCP standard

## Prerequisites

- Node.js 18 or newer
- Google account with access to Google Photos
- Google Cloud project with Photos Library API enabled

## Setup

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Navigate to "APIs & Services" > "Library"
4. Search for and enable "Photos Library API"
5. Go to "APIs & Services" > "Credentials"
6. Click "Create Credentials" > "OAuth client ID"
7. Select "Web application" as the application type
8. Add `http://localhost:3000/auth/callback` as an authorized redirect URI
9. Note your Client ID and Client Secret

### 2. Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your Google Cloud credentials:
   ```
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
   PORT=3000
   NODE_ENV=development
   ```
4. Build the server:
   ```bash
   npm run build
   ```
5. Start the server:
   ```bash
   npm start
   ```
6. Authenticate with Google Photos:
   - Visit `http://localhost:3000` in your browser
   - Click "Authenticate with Google Photos"
   - Follow the Google OAuth flow to grant access to your photos

### Important Authentication Notes

⚠️ **Authentication must be done in HTTP mode first!** 

Before using this MCP server with Claude Desktop or other STDIO-based clients:
1. First run the server in HTTP mode: `npm start`
2. Complete the authentication at `http://localhost:3000/auth`
3. Only after successful authentication, stop the server and switch to STDIO mode for Claude Desktop

The authentication tokens are stored locally and will persist between server restarts.

## Testing with MCP Inspector

The MCP Inspector is an interactive developer tool for testing and debugging MCP servers. It allows you to verify your server's functionality before integrating it with clients like Claude or Cursor.

1. Install and run the MCP Inspector with your server:
   ```bash
   # For HTTP transport
   npx @modelcontextprotocol/inspector node dist/index.js
   
   # For STDIO transport
   npx @modelcontextprotocol/inspector node dist/index.js --stdio
   ```

2. The Inspector will open a web interface (typically at `http://localhost:6274`) where you can:
   - Test all available tools
   - Verify authentication works correctly
   - Inspect request/response payloads
   - Debug any issues with your server

This step is highly recommended before integrating with Claude Desktop or other clients to ensure your server is working correctly.

## Usage with Claude Desktop

To use this MCP server with Claude Desktop:

1. **Ensure you have authenticated first** (see Authentication Notes above)

2. Start the server in STDIO mode:
   ```bash
   npm run stdio
   ```

3. In Claude Desktop, add the MCP server:
   - Go to Settings > MCP Servers
   - Select "Edit Config"
   - Add the following configuration:

   ```json
   {
     "mcpServers": {
       "google-photos": {
         "command": "node",
         "args": ["/path/to/your/project/dist/index.js", "--stdio"],
         "env": {
           "GOOGLE_CLIENT_ID": "your_client_id_here",
           "GOOGLE_CLIENT_SECRET": "your_client_secret_here",
           "GOOGLE_REDIRECT_URI": "http://localhost:3000/auth/callback"
         }
       }
     }
   }
   ```

4. Save the configuration and restart Claude Desktop
5. You can now ask Claude to search and fetch photos from your Google Photos account

## Usage with Cursor IDE

To use this MCP server with Cursor IDE:

1. Start the server in HTTP mode:
   ```bash
   npm start
   ```

2. In Cursor IDE, configure the MCP server:
   - Open the MCP panel in Cursor
   - Click "Add Server"
   - Choose "Command" as the Type
   - Enter the following for Command: `node /path/to/your/project/dist/index.js`
   - Name it "Google Photos"
   - Click "Save"

Alternatively, for HTTP mode:
   - Choose "URL" as the Type
   - Enter the server URL: `http://localhost:3000/mcp`
   - Name it "Google Photos"
   - Click "Save"

## Integration with Smithery

[Smithery](https://smithery.ai/) is a registry for MCP servers that makes it easy to discover and install various MCP tools. You can register your Google Photos MCP server with Smithery to make it available to the community.

To install the Google Photos MCP server from Smithery:

### For Claude Desktop:

```bash
npx -y @smithery/cli install google-photos-mcp --client claude
```

### For Cursor IDE:

```bash
npx -y @smithery/cli install google-photos-mcp --client cursor
```

You can also add a `smithery.yaml` file to your repository with the following content to make it discoverable:

```yaml
name: google-photos-mcp
displayName: Google Photos
description: Access and search your Google Photos library through MCP
logo: https://raw.githubusercontent.com/savethepolarbears/google-photos-mcp/main/logo.png
repository: https://github.com/savethepolarbears/google-photos-mcp
keywords:
  - google photos
  - images
  - albums
  - photos
  - search
```

## Available Tools

### Search Tools

- `search_photos`: Search for photos based on text queries
  ```
  Parameters:
  - query: string (e.g., "vacation 2023", "sunset photos", "cats")
  - pageSize: number (optional, default: 25)
  - pageToken: string (optional, for pagination)
  - includeLocation: boolean (optional, default: true)
  ```

- `search_photos_by_location`: Search for photos based on location
  ```
  Parameters:
  - locationName: string (e.g., "Paris", "Central Park", "Mount Everest")
  - pageSize: number (optional, default: 25)
  - pageToken: string (optional, for pagination)
  ```

### Photo Tools

- `get_photo`: Get a specific photo by ID
  ```
  Parameters:
  - photoId: string
  - includeBase64: boolean (optional, default: false)
  - includeLocation: boolean (optional, default: true)
  ```

- `get_photo_url`: Get a specific photo URL with size options
  ```
  Parameters:
  - photoId: string
  - size: "s" | "m" | "l" | "d" (small, medium, large, original)
  ```

### Album Tools

- `list_albums`: List all albums
  ```
  Parameters:
  - pageSize: number (optional, default: 20)
  - pageToken: string (optional, for pagination)
  ```

- `get_album`: Get a specific album by ID
  ```
  Parameters:
  - albumId: string
  ```

- `list_album_photos`: List photos in a specific album
  ```
  Parameters:
  - albumId: string
  - pageSize: number (optional, default: 25)
  - pageToken: string (optional, for pagination)
  - includeLocation: boolean (optional, default: true)
  ```

## Example Queries for Claude

Once your MCP server is set up and connected to Claude, you can ask queries like:

- "Show me photos from my trip to Paris"
- "Find photos of my dog"
- "Show me photos from last summer"
- "Get photos from my 'Family' album"
- "Show me landscape photos from 2023"
- "Find photos taken in Yellowstone National Park"

## Location Data Support

The Google Photos API doesn't provide exact geolocation coordinates directly. This implementation attempts to extract location information from photo descriptions and uses geocoding to provide approximate location data when possible. Location features include:

- Extracting location information from photo descriptions
- Geocoding location names to obtain coordinates (using OpenStreetMap/Nominatim)
- Searching photos by location name
- Including location data in search results (when available)

Note that location data is approximate and may not be available for all photos.

## Troubleshooting

If you encounter issues:

1. Verify your API credentials are correct in the `.env` file
2. Check the MCP server logs for error messages
3. Use the MCP Inspector to test the server directly
4. Ensure you've authorized the application with Google Photos
5. Try restarting the server and client application

## License

MIT
