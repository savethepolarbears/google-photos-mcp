import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import config from '../utils/config.js';
import { TokenData } from '../auth/tokens.js';

/**
 * OAuth2 client management for Google Photos API
 */

/**
 * Creates a new OAuth2 client using the configured credentials.
 *
 * @returns A new OAuth2Client instance.
 */
export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

/**
 * Sets up an OAuth2 client with the provided tokens.
 *
 * @param tokens - The tokens to use for authentication.
 * @returns An authenticated OAuth2Client instance.
 */
export function setupOAuthClient(tokens: TokenData): OAuth2Client {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
  });
  return oauth2Client;
}

/**
 * Gets the authorized headers for a Google Photos API request.
 *
 * @param auth - The authenticated OAuth2 client.
 * @returns A Promise resolving to the headers object.
 * @throws Error if authorization fails.
 */
export async function getAuthorizedHeaders(auth: OAuth2Client): Promise<Record<string, string>> {
  try {
    return await auth.getRequestHeaders();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Authorization failed: ${message}`);
  }
}
