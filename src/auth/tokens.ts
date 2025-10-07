import fs from 'fs/promises';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  userEmail?: string;
  userId?: string;
  retrievedAt?: number;
}

/**
 * Save authentication tokens for a user
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
 * Get tokens for a specific user
 * If useDefault is true and the specific userId's tokens aren't found,
 * it will return the first available tokens
 */
const isValidToken = (entry: unknown): entry is TokenData => (
  !!entry &&
  typeof entry === 'object' &&
  'access_token' in entry &&
  'refresh_token' in entry &&
  'expiry_date' in entry
);

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
 * Get the first available tokens from any user
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
 * Remove tokens for a specific user
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