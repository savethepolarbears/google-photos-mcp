import fs from 'fs/promises';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

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
 * If useDefault is true and the specific userId's tokens aren't found,
 * it will return the first available tokens
 */
export async function getTokens(userId: string, useDefault: boolean = false): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(config.tokens.path, 'utf-8');
    const allTokens: Record<string, any> = JSON.parse(data);
    
    // Helper function to check if an entry contains valid token data
    const isValidToken = (entry: any): boolean => (
      entry && 
      typeof entry === 'object' && 
      'access_token' in entry && 
      'refresh_token' in entry &&
      'expiry_date' in entry
    );
    
    // If we have tokens for this specific user, return them if they're valid
    if (allTokens[userId] && isValidToken(allTokens[userId])) {
      return allTokens[userId] as TokenData;
    }
    
    // If useDefault is true, look for any valid tokens
    if (useDefault) {
      const validUserIds = Object.keys(allTokens).filter(key => isValidToken(allTokens[key]));
      
      if (validUserIds.length > 0) {
        const firstUserId = validUserIds[0];
        logger.debug(`Using default tokens from user ${firstUserId}`);
        return allTokens[firstUserId] as TokenData;
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
    
    const allTokens: Record<string, any> = JSON.parse(data);
    
    // Filter out any non-token entries (like "web" client details)
    const validUserIds = Object.keys(allTokens).filter(key => 
      allTokens[key] && 
      typeof allTokens[key] === 'object' && 
      'access_token' in allTokens[key] && 
      'refresh_token' in allTokens[key] &&
      'expiry_date' in allTokens[key]
    );
    
    // Return the first available valid tokens
    if (validUserIds.length > 0) {
      const firstUserId = validUserIds[0];
      logger.debug(`Using tokens from user ${firstUserId}`);
      return allTokens[firstUserId] as TokenData;
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