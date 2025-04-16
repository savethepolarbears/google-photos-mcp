import { McpServer } from '@modelcontextprotocol/sdk';
import { registerSearchTools } from './search';
import { registerAlbumTools } from './albums';
import { registerPhotoTools } from './photos';
import { registerLocationTools } from './location';

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: McpServer): void {
  // Register search-related tools
  registerSearchTools(server);
  
  // Register album-related tools
  registerAlbumTools(server);
  
  // Register photo-related tools
  registerPhotoTools(server);
  
  // Register location-related tools
  registerLocationTools(server);
}
