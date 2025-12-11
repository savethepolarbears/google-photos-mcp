import fs from 'fs/promises';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Interface representing the stored token data.
 */
export interface TokenData {
  /** OAuth2 access token */
  access_token: string;
  /** OAuth2 refresh token */
  refresh_token: string;
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
 * Save authentication tokens for a user to the file system.
 * Creates the tokens directory if it doesn't exist.
 * Updates the existing tokens file or creates a new one.
 *
 * @param userId - The unique identifier of the user.
 * @param tokens - The token data to save.
 * @throws Error if saving tokens fails.
 */
export async function saveTokens(userId: string, tokens: TokenData): Promise<void> {
  try {
    // Create tokens directory if it doesn't exist
    const tokensDir = path.dirname(config.tokens.path);
    await fs.mkdir(tokensDir, { recursive: true });
    
    // Read existing tokens file or create empty object
    let allTokens: Record<string, TokenData> = {};
    try {
      const data = await fs.readFile(config.tokens.path, 'utf-8');
      allTokens = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is invalid, start with empty object
      logger.info('Creating new tokens storage file');
    }
    
    // Update tokens for this user and ensure we track retrieval time
    const timestamp = Date.now();
    const tokensWithTimestamp: TokenData = {
      ...tokens,
      retrievedAt: timestamp,
    };
    allTokens[userId] = tokensWithTimestamp;
    
    // Write back to file
    await fs.writeFile(config.tokens.path, JSON.stringify(allTokens, null, 2));
    logger.debug(`Saved tokens for user ${userId}`);
  } catch (error) {
    logger.error(`Failed to save tokens: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to save tokens');
  }
}

/**
 * Type guard to check if an object is a valid TokenData object.
 *
 * @param entry - The object to check.
 * @returns True if the object is a valid TokenData, false otherwise.
 */
const isValidToken = (entry: unknown): entry is TokenData => (
  !!entry &&
  typeof entry === 'object' &&
  'access_token' in entry &&
  'refresh_token' in entry &&
  'expiry_date' in entry
);

/**
 * Helper to find the newest valid token from a record of tokens.
 *
 * @param allTokens - Record of all tokens.
 * @returns A tuple of [userId, TokenData] or null if no valid tokens found.
 */
const getNewestValidToken = (
  allTokens: Record<string, unknown>,
): [string, TokenData] | null => {
  const validEntries = Object.entries(allTokens)
    .filter(([, entry]) => isValidToken(entry)) as [string, TokenData][];

  if (validEntries.length === 0) {
    return null;
  }

  validEntries.sort(([, a], [, b]) => {
    const aTime = typeof a.retrievedAt === 'number' ? a.retrievedAt : 0;
    const bTime = typeof b.retrievedAt === 'number' ? b.retrievedAt : 0;
    return bTime - aTime;
  });

  return validEntries[0];
};

/**
 * Get tokens for a specific user.
 *
 * @param userId - The unique identifier of the user.
 * @param useDefault - If true, returns the most recently used tokens if the specific user's tokens are not found. Default is false.
 * @returns A Promise resolving to TokenData or null if not found.
 */
export async function getTokens(userId: string, useDefault: boolean = false): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(config.tokens.path, 'utf-8');
    const allTokens: Record<string, unknown> = JSON.parse(data);

    // If we have tokens for this specific user, return them if they're valid
    if (allTokens[userId] && isValidToken(allTokens[userId])) {
      return allTokens[userId] as TokenData;
    }

    // If useDefault is true, look for any valid tokens
    if (useDefault) {
      const newest = getNewestValidToken(allTokens);

      if (newest) {
        const [selectedUserId, tokens] = newest;
        logger.debug(`Using default tokens from user ${selectedUserId}`);
        return tokens;
      }
    }
    
    // No valid tokens found
    return null;
  } catch (error) {
    logger.debug(`No tokens found or error reading tokens: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get the first available tokens from any user.
 * This is useful for single-user scenarios or when any valid credential will do.
 *
 * @returns A Promise resolving to TokenData or null if no tokens are found.
 */
export async function getFirstAvailableTokens(): Promise<TokenData | null> {
  try {
    // Check if file exists first
    try {
      await fs.access(config.tokens.path);
    } catch (err) {
      logger.debug('Tokens file does not exist');
      return null;
    }
    
    const data = await fs.readFile(config.tokens.path, 'utf-8');
    
    // Check if file is empty
    if (!data || data.trim() === '' || data.trim() === '{}') {
      logger.debug('Tokens file is empty');
      return null;
    }
    
    const allTokens: Record<string, unknown> = JSON.parse(data);

    const newest = getNewestValidToken(allTokens);

    if (newest) {
      const [selectedUserId, tokens] = newest;
      logger.debug(`Using tokens from user ${selectedUserId}`);
      return tokens;
    }
    
    // No valid tokens found
    return null;
  } catch (error) {
    logger.debug(`No tokens found or error reading tokens: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Remove tokens for a specific user from the storage.
 *
 * @param userId - The unique identifier of the user whose tokens should be removed.
 * @returns A Promise resolving when the operation is complete.
 */
export async function removeTokens(userId: string): Promise<void> {
  try {
    const data = await fs.readFile(config.tokens.path, 'utf-8');
    const allTokens: Record<string, TokenData> = JSON.parse(data);
    
    if (allTokens[userId]) {
      delete allTokens[userId];
      await fs.writeFile(config.tokens.path, JSON.stringify(allTokens, null, 2));
      logger.debug(`Removed tokens for user ${userId}`);
    }
  } catch (error) {
    logger.error(`Failed to remove tokens: ${error instanceof Error ? error.message : String(error)}`);
  }
}
