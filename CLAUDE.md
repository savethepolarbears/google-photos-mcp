# Google Photos MCP Usage Guide for Claude

## Overview

This is an MCP (Model Context Protocol) server that allows Claude to search and interact with your Google Photos library. It enables Claude to:

- Search photos by content, keywords, dates, and locations
- Get detailed information about specific photos
- List and browse photo albums
- Access location data for photos (when available)

## Available Tools

### Search Photos

```
search_photos
```

Search for photos based on text queries.

**Parameters:**
- `query`: (string, required) Search query for photos (e.g., "vacation 2023", "sunset photos", "cats")
- `pageSize`: (number, optional) Number of results to return (default: 25)
- `pageToken`: (string, optional) Token for pagination
- `includeLocation`: (boolean, optional) Whether to include location data (default: true)

**Example usage:**
"Find photos of my dog"
"Show me photos from my trip to Paris"
"Search for vacation photos from 2022"

### Search Photos by Location

```
search_photos_by_location
```

Search for photos based on location name.

**Parameters:**
- `locationName`: (string, required) Location name to search for (e.g., "Paris", "New York", "Tokyo")
- `pageSize`: (number, optional) Number of results to return (default: 25)
- `pageToken`: (string, optional) Token for pagination

**Example usage:**
"Find photos taken in Tokyo"
"Show me pictures from my trip to the Grand Canyon"

### Get Photo

```
get_photo
```

Get details of a specific photo by ID.

**Parameters:**
- `photoId`: (string, required) ID of the photo to retrieve
- `includeBase64`: (boolean, optional) Whether to include base64-encoded image data (default: false)
- `includeLocation`: (boolean, optional) Whether to include location data (default: true)

**Example usage:**
"Show me details of this photo" (when referring to a specific photo ID)

### List Albums

```
list_albums
```

List all photo albums.

**Parameters:**
- `pageSize`: (number, optional) Number of results to return (default: 20)
- `pageToken`: (string, optional) Token for pagination

**Example usage:**
"List my photo albums"
"Show me all my Google Photos albums"

### Get Album

```
get_album
```

Get details of a specific album by ID.

**Parameters:**
- `albumId`: (string, required) ID of the album to retrieve

**Example usage:**
"Show me details about my 'Vacation 2023' album"

### List Album Photos

```
list_album_photos
```

List photos in a specific album.

**Parameters:**
- `albumId`: (string, required) ID of the album to retrieve photos from
- `pageSize`: (number, optional) Number of results to return (default: 25)
- `pageToken`: (string, optional) Token for pagination
- `includeLocation`: (boolean, optional) Whether to include location data (default: true)

**Example usage:**
"Show me photos from my 'Family' album"
"List pictures in my Paris trip album"

## Authentication Notes

- Users must authenticate with their Google account before using this MCP
- Authentication is done through the OAuth2 flow
- **Important**: You must authenticate before using this MCP with Claude
  
### Authentication Steps:

1. Start the server in HTTP mode:
   ```bash
   npm start
   ```
2. Visit http://localhost:3000/auth in your browser
3. Follow the Google OAuth authentication flow
4. After successful authentication, you can use with Claude for Desktop:
   - Stop the HTTP server (Ctrl+C)
   - Start in STDIO mode: `npm run stdio`
   - Configure in Claude for Desktop settings

### Claude for Desktop Configuration:

1. Open Claude for Desktop
2. Go to Settings > MCP Servers
3. Click "Edit Config"
4. Add the following configuration:

```json
{
  "mcpServers": {
    "google-photos": {
      "command": "node",
      "args": ["/Users/klkro/claude-mcps/google-photos/dist/index.js", "--stdio"],
      "env": {}
    }
  }
}
```

5. Replace the path with the absolute path to your project's dist/index.js file
6. Save the configuration and restart Claude Desktop

### Checking Authentication Status

You can use the `auth_status` tool to check if you're properly authenticated:

```
auth_status
```

This will tell you if you're authenticated and provide guidance if you're not.

## Testing with Claude

Once you've configured the MCP server in Claude for Desktop, you can test it with these commands:

1. First, check authentication status:
   ```
   Check if I'm authenticated with Google Photos by using the auth_status tool
   ```

2. List your albums:
   ```
   List my Google Photos albums
   ```

3. Search for specific photos:
   ```
   Search for vacation photos from last year
   ```

4. Search by location:
   ```
   Find photos taken in New York
   ```

If Claude responds with proper photo information, the MCP is working correctly!

## Troubleshooting

If you encounter issues:

1. **Authentication Errors**: Ensure you've completed the authentication process and have valid tokens in the tokens.json file
2. **JSON Parsing Errors**: Make sure there are no syntax errors in your Claude configuration
3. **Connection Issues**: Verify the path to index.js in your Claude config is correct
4. **"Method not found" Errors**: Ensure you're using the latest version of the MCP

## Location Data

- Location data is approximate and extracted from photo descriptions
- The Google Photos API doesn't provide exact GPS coordinates directly
- When available, location information includes:
  - Approximate latitude/longitude
  - Location name
  - City, region, country (when available)

## Pagination

Many tools support pagination through:
- `pageSize`: Control how many results to return
- `pageToken`: Token for getting the next page of results

## Response Format

Responses are JSON objects containing:
- Photo details (id, filename, description, date, URLs)
- Location information (when available and requested)
- Pagination tokens for fetching more results

## Best Practices

- Use specific search terms for better results
- Include dates, locations, or content categories when searching
- For large collections, use pagination to retrieve all results
- Remember that location data is approximate and may not be available for all photos