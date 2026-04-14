import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config({ override: true });

// Derive project root from this file's location (src/utils/config.ts or dist/utils/config.js -> ../../)
// This is stable regardless of process.cwd(), which varies depending on how the MCP client launches the server.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Validates and sanitizes the token storage path to prevent path traversal attacks.
 * Ensures the path stays within the project directory.
 *
 * @param inputPath - The token storage path from environment or default
 * @returns Validated absolute path
 * @throws Error if path escapes project directory
 */
function validateTokenStoragePath(inputPath: string): string {
  const resolvedPath = path.resolve(PROJECT_ROOT, inputPath);
  const relativePath = path.relative(PROJECT_ROOT, resolvedPath);

  // Prevent path traversal outside project directory
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `SECURITY ERROR: TOKEN_STORAGE_PATH must be within project directory.\n` +
        `Attempted path: ${inputPath}\n` +
        `Resolved to: ${resolvedPath}\n` +
        `This prevents path traversal attacks.`,
    );
  }

  return resolvedPath;
}

/**
 * Global configuration object for the application.
 * Values are loaded from environment variables or use default fallbacks.
 */
const config = {
  /**
   * Google OAuth Configuration.
   * Contains credentials and scopes required for authenticating with Google Photos API.
   */
  google: {
    /** Google Cloud Project Client ID */
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    /** Google Cloud Project Client Secret */
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    /**
     * OAuth Redirect URI.
     * Must match the one configured in Google Cloud Console.
     * Default: 'http://localhost:3000/auth/callback'
     */
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/callback",
    /**
     * OAuth scopes required by the application.
     * Note: Access may be limited to app-created content after March 31, 2025 due to API changes.
     */
    scopes: [
      // Post-March 31, 2025: Only these three scopes remain valid for Library API.
      // The deprecated photoslibrary, photoslibrary.readonly, and photoslibrary.sharing
      // scopes have been removed and will return 403 PERMISSION_DENIED.
      "https://www.googleapis.com/auth/photoslibrary.appendonly",
      "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
      "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata",
      // Picker API: Required to let users select existing photos from their full library
      "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    ],
  },

  /**
   * Server Configuration.
   * Settings for the HTTP server.
   */
  server: {
    /** Port to listen on (default: 3000) */
    port: parseInt(process.env.PORT || "3000", 10),
    /** Node environment (e.g., 'development', 'production') */
    env: process.env.NODE_ENV || "development",
  },

  /**
   * MCP Server Configuration.
   * Metadata for the Model Context Protocol server.
   */
  mcp: {
    /** Name of the MCP server */
    name: process.env.MCP_SERVER_NAME || "google-photos-mcp",
    /** Version of the MCP server */
    version: process.env.MCP_SERVER_VERSION || "0.1.0",
  },

  /**
   * Logger Configuration.
   */
  logger: {
    /** Minimum log level (default: 'info') */
    level: process.env.LOG_LEVEL || "info",
  },

  /**
   * Token Storage Configuration.
   */
  tokens: {
    /** SQLite database file path for keyv token storage (validated to prevent path traversal) */
    dbPath: validateTokenStoragePath(
      process.env.TOKEN_STORAGE_PATH || path.join(PROJECT_ROOT, "tokens.db"),
    ),
  },
};

// Check required configuration
const requiredEnvVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

// Only warn about missing env vars in non-STDIO mode
const useStdio = process.argv.includes("--stdio");
const isTestEnv = process.env.NODE_ENV === "test";
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar] && !useStdio && !isTestEnv) {
    console.warn(
      `Warning: Required environment variable ${envVar} is not set.`,
    );
  }
});

// Security: Validate HTTPS redirect URI in production (MCP + OAuth 2.1 requirement)
if (config.server.env === "production") {
  if (!config.google.redirectUri.startsWith("https://")) {
    throw new Error(
      `SECURITY ERROR: GOOGLE_REDIRECT_URI must use HTTPS in production.\n` +
        `Current value: ${config.google.redirectUri}\n` +
        `This prevents MITM attacks on the OAuth flow.`,
    );
  }
}

// Warn about HTTP redirect URI in non-localhost scenarios
if (
  config.google.redirectUri.startsWith("http://") &&
  !config.google.redirectUri.includes("localhost") &&
  !config.google.redirectUri.includes("127.0.0.1")
) {
  console.warn(
    `⚠️  SECURITY WARNING: OAuth redirect URI is using HTTP: ${config.google.redirectUri}\n` +
      `   This is only safe for localhost. Use HTTPS for production deployments.`,
  );
}

export default config;
