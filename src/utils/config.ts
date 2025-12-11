import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

/**
 * Global configuration object for the application.
 * Values are loaded from environment variables or use default fallbacks.
 */
export const config = {
  /**
   * Google OAuth Configuration.
   * Contains credentials and scopes required for authenticating with Google Photos API.
   */
  google: {
    /** Google Cloud Project Client ID */
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    /** Google Cloud Project Client Secret */
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    /**
     * OAuth Redirect URI.
     * Must match the one configured in Google Cloud Console.
     * Default: 'http://localhost:3000/auth/callback'
     */
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    /**
     * OAuth scopes required by the application.
     * Note: Access may be limited to app-created content after March 31, 2025 due to API changes.
     */
    scopes: [
      // Note: As of March 31, 2025, photoslibrary.readonly scope is deprecated
      // This will only allow access to app-created photos and albums
      // For full library access, users should use the Google Photos Picker API
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      // Alternative scope for 2025+ (requires app-created content only)
      // 'https://www.googleapis.com/auth/photoslibrary.appendonly',
    ],
  },
  
  /**
   * Server Configuration.
   * Settings for the HTTP server.
   */
  server: {
    /** Port to listen on (default: 3000) */
    port: parseInt(process.env.PORT || '3000', 10),
    /** Node environment (e.g., 'development', 'production') */
    env: process.env.NODE_ENV || 'development',
  },
  
  /**
   * MCP Server Configuration.
   * Metadata for the Model Context Protocol server.
   */
  mcp: {
    /** Name of the MCP server */
    name: process.env.MCP_SERVER_NAME || 'google-photos-mcp',
    /** Version of the MCP server */
    version: process.env.MCP_SERVER_VERSION || '0.1.0',
  },
  
  /**
   * Logger Configuration.
   */
  logger: {
    /** Minimum log level (default: 'info') */
    level: process.env.LOG_LEVEL || 'info',
  },
  
  /**
   * Token Storage Configuration.
   */
  tokens: {
    /** File path where authentication tokens are stored */
    path: process.env.TOKEN_STORAGE_PATH || path.join(process.cwd(), 'tokens.json'),
  },
};

// Check required configuration
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

// Only warn about missing env vars in non-STDIO mode
const useStdio = process.argv.includes('--stdio');
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar] && !useStdio) {
    console.warn(`Warning: Required environment variable ${envVar} is not set.`);
  }
});

export default config;
