import keytar from 'keytar';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const SERVICE_NAME = 'google-photos-mcp';
const METADATA_DIR = path.join(process.cwd(), '.google-photos-mcp');

/**
 * Token data stored in OS keychain (sensitive fields only)
 */
export interface SecureTokenData {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expiry_date: number;
}

/**
 * Metadata stored in JSON file (non-sensitive)
 */
export interface TokenMetadata {
  userId: string;
  userEmail?: string;
  retrievedAt: number;
  lastRefreshed?: number;
}

/**
 * Combined token data with metadata
 */
export interface TokenDataWithMetadata extends SecureTokenData {
  userId: string;
  userEmail?: string;
}

/**
 * Saves OAuth tokens securely using OS keychain.
 * Sensitive data (tokens) go to keychain, metadata goes to JSON file.
 *
 * @param userId - Unique identifier for the user (typically Google sub claim)
 * @param tokens - Token data including access_token, refresh_token, etc.
 * @param metadata - Non-sensitive metadata (email, timestamps)
 */
export async function saveTokensSecure(
  userId: string,
  tokens: SecureTokenData,
  metadata: { userEmail?: string }
): Promise<void> {
  try {
    // Ensure metadata directory exists
    await fs.mkdir(METADATA_DIR, { recursive: true });

    // Store sensitive tokens in OS keychain
    const tokenPayload = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expiry_date: tokens.expiry_date,
    });

    await keytar.setPassword(SERVICE_NAME, userId, tokenPayload);

    // Store non-sensitive metadata in JSON file
    const metadataFile = path.join(METADATA_DIR, `${userId}.meta.json`);
    const metadataPayload: TokenMetadata = {
      userId,
      userEmail: metadata.userEmail,
      retrievedAt: Date.now(),
    };

    await fs.writeFile(metadataFile, JSON.stringify(metadataPayload, null, 2));
    // Set restrictive file permissions (owner read/write only)
    await fs.chmod(metadataFile, 0o600);

    logger.info(`Securely saved tokens for user ${userId} to OS keychain`);
  } catch (error) {
    logger.error(`Failed to save tokens securely for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Retrieves OAuth tokens from OS keychain.
 * Combines keychain data with metadata file.
 *
 * @param userId - User identifier to retrieve tokens for
 * @returns Token data with metadata, or null if not found
 */
export async function getTokensSecure(userId: string): Promise<TokenDataWithMetadata | null> {
  try {
    // Retrieve sensitive tokens from keychain
    const tokenPayload = await keytar.getPassword(SERVICE_NAME, userId);
    if (!tokenPayload) {
      return null;
    }

    const tokens: SecureTokenData = JSON.parse(tokenPayload);

    // Retrieve metadata from JSON file
    const metadataFile = path.join(METADATA_DIR, `${userId}.meta.json`);
    let metadata: TokenMetadata;

    try {
      const metadataContent = await fs.readFile(metadataFile, 'utf-8');
      metadata = JSON.parse(metadataContent);
    } catch (error) {
      // Metadata file missing - return tokens without metadata
      logger.warn(`Metadata file missing for user ${userId}, returning tokens without metadata`);
      return {
        ...tokens,
        userId,
      };
    }

    return {
      ...tokens,
      userId: metadata.userId,
      userEmail: metadata.userEmail,
    };
  } catch (error) {
    logger.error(`Failed to retrieve tokens for user ${userId}:`, error);
    return null;
  }
}

/**
 * Lists all users with stored tokens.
 * Reads from metadata directory.
 *
 * @returns Array of user IDs
 */
export async function listStoredUsers(): Promise<string[]> {
  try {
    await fs.mkdir(METADATA_DIR, { recursive: true });
    const files = await fs.readdir(METADATA_DIR);

    return files
      .filter(f => f.endsWith('.meta.json'))
      .map(f => f.replace('.meta.json', ''));
  } catch (error) {
    logger.error('Failed to list stored users:', error);
    return [];
  }
}

/**
 * Removes tokens for a specific user from OS keychain and deletes metadata.
 *
 * @param userId - User identifier to remove tokens for
 */
export async function removeTokensSecure(userId: string): Promise<void> {
  try {
    // Remove from keychain
    const deleted = await keytar.deletePassword(SERVICE_NAME, userId);

    // Remove metadata file
    const metadataFile = path.join(METADATA_DIR, `${userId}.meta.json`);
    try {
      await fs.unlink(metadataFile);
    } catch (error) {
      // Metadata file might not exist
      logger.debug(`Metadata file for ${userId} already deleted or missing`);
    }

    if (deleted) {
      logger.info(`Removed tokens for user ${userId} from OS keychain`);
    } else {
      logger.warn(`No tokens found for user ${userId} in OS keychain`);
    }
  } catch (error) {
    logger.error(`Failed to remove tokens for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Migrates tokens from legacy plaintext storage to secure keychain storage.
 * Reads tokens.json, stores each user's tokens in keychain, then deletes tokens.json.
 *
 * @param legacyTokensPath - Path to the legacy tokens.json file
 */
export async function migrateLegacyTokens(legacyTokensPath: string): Promise<void> {
  try {
    // Check if legacy file exists
    try {
      await fs.access(legacyTokensPath);
    } catch {
      logger.info('No legacy tokens.json file found - migration not needed');
      return;
    }

    // Read legacy tokens
    const content = await fs.readFile(legacyTokensPath, 'utf-8');
    const legacyTokens: Record<string, any> = JSON.parse(content);

    let migratedCount = 0;

    // Migrate each user's tokens to keychain
    for (const [userId, tokenData] of Object.entries(legacyTokens)) {
      await saveTokensSecure(
        userId,
        {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          id_token: tokenData.id_token,
          expiry_date: tokenData.expiry_date,
        },
        {
          userEmail: tokenData.userEmail,
        }
      );
      migratedCount++;
    }

    // Backup legacy file
    const backupPath = `${legacyTokensPath}.backup-${Date.now()}`;
    await fs.rename(legacyTokensPath, backupPath);

    logger.info(`Migrated ${migratedCount} users from plaintext to secure keychain storage`);
    logger.info(`Legacy tokens backed up to: ${backupPath}`);
  } catch (error) {
    logger.error('Failed to migrate legacy tokens:', error);
    throw error;
  }
}
