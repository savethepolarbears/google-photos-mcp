import { OAuth2Client } from 'google-auth-library';
import logger from '../utils/logger.js';
import { TokenData, saveTokens } from './tokens.js';

/**
 * Manages token refresh operations with mutex to prevent concurrent refreshes.
 * Ensures only one refresh happens at a time per user.
 */
export class TokenRefreshManager {
  private refreshPromises = new Map<string, Promise<TokenData>>();

  /**
   * Refreshes an expired token if needed, with mutex to prevent concurrent refreshes.
   *
   * @param oauth2Client - The OAuth2 client configured with current tokens
   * @param userId - The user ID whose token to refresh
   * @param currentTokens - The current token data
   * @returns Promise resolving to refreshed tokens (or current if not expired)
   *
   * @example
   * ```typescript
   * const freshTokens = await tokenRefreshManager.refreshIfNeeded(
   *   oauth2Client,
   *   'user@example.com',
   *   currentTokens
   * );
   * ```
   */
  async refreshIfNeeded(
    oauth2Client: OAuth2Client,
    userId: string,
    currentTokens: TokenData
  ): Promise<TokenData> {
    // Check if refresh is already in progress for this user
    const existingRefresh = this.refreshPromises.get(userId);
    if (existingRefresh) {
      logger.debug(`Token refresh already in progress for user ${userId}, waiting...`);
      return existingRefresh;
    }

    // Check if token is actually expired (5 min buffer for safety)
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes
    if (currentTokens.expiry_date > Date.now() + expiryBuffer) {
      logger.debug(`Token for user ${userId} is still valid, no refresh needed`);
      return currentTokens; // Still valid
    }

    // Start refresh and cache the promise to prevent concurrent refreshes
    const refreshPromise = this.performRefresh(oauth2Client, userId, currentTokens);
    this.refreshPromises.set(userId, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      // Always remove from map when done (success or failure)
      this.refreshPromises.delete(userId);
    }
  }

  /**
   * Performs the actual token refresh operation
   */
  private async performRefresh(
    oauth2Client: OAuth2Client,
    userId: string,
    currentTokens: TokenData
  ): Promise<TokenData> {
    try {
      logger.info(`Refreshing access token for user ${userId}`);

      const { credentials } = await oauth2Client.refreshAccessToken();

      const newTokens: TokenData = {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || currentTokens.refresh_token,
        expiry_date: credentials.expiry_date || 0,
        userEmail: currentTokens.userEmail,
        userId: currentTokens.userId,
        retrievedAt: Date.now(),
      };

      // Save refreshed tokens
      await saveTokens(userId, newTokens);

      logger.info(`Successfully refreshed token for user ${userId}`);
      return newTokens;
    } catch (error) {
      logger.error(
        `Failed to refresh token for user ${userId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Gets statistics about ongoing refresh operations
   */
  getStats(): { activeRefreshes: number; userIds: string[] } {
    return {
      activeRefreshes: this.refreshPromises.size,
      userIds: Array.from(this.refreshPromises.keys()),
    };
  }
}

/**
 * Singleton instance for global token refresh coordination
 */
export const tokenRefreshManager = new TokenRefreshManager();
