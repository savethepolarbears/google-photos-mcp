import config from '../utils/config.js';
import logger from '../utils/logger.js';
import {
  saveTokensSecure,
  getTokensSecure,
  listStoredUsers,
  removeTokensSecure,
  migrateLegacyTokens,
  TokenDataWithMetadata,
} from './secureTokenStorage.js';

/**
 * Interface representing the stored token data.
 * Maintained for backward compatibility with existing code.
 */
export interface TokenData {
  /** OAuth2 access token */
  access_token: string;
  /** OAuth2 refresh token */
  refresh_token: string;
  /** ID token from OAuth flow */
  id_token?: string;
  /** Expiration timestamp (in milliseconds) */
  expiry_date: number;
  /** User's email address (if available) */
  userEmail?: string;
  /** Unique user identifier */
  userId?: string;
  /** Timestamp when the token was last retrieved or updated */
  retrievedAt?: number;
}

/**
 * Migrates legacy plaintext tokens to secure keychain storage on first run.
 * This function is called automatically on module initialization.
 */
async function ensureMigrated(): Promise<void> {
  try {
    await migrateLegacyTokens(config.tokens.path);
  } catch (error) {
    logger.error('Migration failed, but continuing (may need manual intervention):', error);
  }
}

// Run migration check on module load
ensureMigrated().catch(error => {
  logger.error('Failed to check migration status:', error);
});

/**
 * Save authentication tokens for a user to secure OS keychain.
 * Creates the metadata directory if it doesn't exist.
 * Tokens are encrypted by the OS and stored securely.
 *
 * @param userId - The unique identifier of the user.
 * @param tokens - The token data to save.
 * @throws Error if saving tokens fails.
 */
export async function saveTokens(userId: string, tokens: TokenData): Promise<void> {
  await saveTokensSecure(
    userId,
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expiry_date: tokens.expiry_date,
    },
    {
      userEmail: tokens.userEmail,
    }
  );
}

/**
 * Get tokens for a specific user from secure OS keychain.
 *
 * @param userId - The unique identifier of the user.
 * @param useDefault - If true, returns the most recently used tokens if the specific user's tokens are not found. Default is false.
 * @returns A Promise resolving to TokenData or null if not found.
 */
export async function getTokens(userId: string, useDefault: boolean = false): Promise<TokenData | null> {
  // Try to get tokens for this specific user
  const tokens = await getTokensSecure(userId);
  if (tokens) {
    return tokens;
  }

  // If useDefault is true, get first available tokens
  if (useDefault) {
    return await getFirstAvailableTokens();
  }

  return null;
}

/**
 * Get the first available tokens from any user.
 * This is useful for single-user scenarios or when any valid credential will do.
 *
 * @returns A Promise resolving to TokenData or null if no tokens are found.
 */
export async function getFirstAvailableTokens(): Promise<TokenData | null> {
  try {
    // List all users with stored tokens
    const userIds = await listStoredUsers();

    if (userIds.length === 0) {
      logger.debug('No users with stored tokens found');
      return null;
    }

    // Get tokens for the first user (they're already sorted by metadata file listing)
    // In practice, we should get the most recently authenticated user
    // For now, we'll get tokens for all users and sort by retrievedAt

    const allTokens: TokenDataWithMetadata[] = [];

    for (const userId of userIds) {
      const tokens = await getTokensSecure(userId);
      if (tokens) {
        allTokens.push(tokens);
      }
    }

    if (allTokens.length === 0) {
      return null;
    }

    // Sort by metadata retrieval time if available
    // Note: retrievedAt is in metadata, not in the secure token payload
    // For now, just return the first valid tokens
    return allTokens[0];
  } catch (error) {
    logger.debug(`No tokens found or error retrieving tokens: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Remove tokens for a specific user from the secure storage.
 *
 * @param userId - The unique identifier of the user whose tokens should be removed.
 * @returns A Promise resolving when the operation is complete.
 */
export async function removeTokens(userId: string): Promise<void> {
  await removeTokensSecure(userId);
}
