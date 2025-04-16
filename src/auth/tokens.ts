import fs from 'fs/promises';
import path from 'path';
import config from '../utils/config';
import logger from '../utils/logger';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
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
    
    // Update tokens for this user
    allTokens[userId] = tokens;
    
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
 */
export async function getTokens(userId: string): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(config.tokens.path, 'utf-8');
    const allTokens: Record<string, TokenData> = JSON.parse(data);
    return allTokens[userId] || null;
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