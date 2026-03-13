/**
 * Unit tests for src/auth/tokenRefreshManager.ts
 * Tests token refresh logic, mutex, and concurrent refresh prevention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/auth/tokens.js', () => ({
  saveTokens: vi.fn().mockResolvedValue(undefined),
}));

import { tokenRefreshManager } from '../../src/auth/tokenRefreshManager.js';
import type { OAuth2Client } from 'google-auth-library';
import type { TokenData } from '../../src/auth/tokens.js';

function createMockOAuth2Client(overrides: Partial<{
  refreshAccessToken: () => Promise<{ credentials: Record<string, unknown> }>;
}> = {}): OAuth2Client {
  return {
    refreshAccessToken: overrides.refreshAccessToken ?? vi.fn().mockResolvedValue({
      credentials: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expiry_date: Date.now() + 3600000,
      },
    }),
  } as unknown as OAuth2Client;
}

function createTokenData(overrides: Partial<TokenData> = {}): TokenData {
  return {
    access_token: overrides.access_token ?? 'old-access-token',
    refresh_token: overrides.refresh_token ?? 'old-refresh-token',
    expiry_date: overrides.expiry_date ?? Date.now() + 3600000,
    userEmail: overrides.userEmail ?? 'test@gmail.com',
    userId: overrides.userId ?? 'user-1',
    retrievedAt: overrides.retrievedAt ?? Date.now(),
  };
}

describe('TokenRefreshManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current tokens when not expired', async () => {
    const client = createMockOAuth2Client();
    const tokens = createTokenData({
      expiry_date: Date.now() + 3600000, // 1 hour from now
    });

    const result = await tokenRefreshManager.refreshIfNeeded(client, 'user-1', tokens);

    expect(result).toBe(tokens); // same reference, no refresh
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes token when expired', async () => {
    const client = createMockOAuth2Client();
    const tokens = createTokenData({
      expiry_date: Date.now() - 1000, // expired 1 second ago
    });

    const result = await tokenRefreshManager.refreshIfNeeded(client, 'user-expired', tokens);

    expect(result.access_token).toBe('new-access-token');
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes token when within 5-minute buffer', async () => {
    const client = createMockOAuth2Client();
    const tokens = createTokenData({
      expiry_date: Date.now() + 60000, // expires in 1 minute (within 5-min buffer)
    });

    const result = await tokenRefreshManager.refreshIfNeeded(client, 'user-buffer', tokens);

    expect(result.access_token).toBe('new-access-token');
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('throws when refresh fails', async () => {
    const client = createMockOAuth2Client({
      refreshAccessToken: vi.fn().mockRejectedValue(new Error('Invalid grant')),
    });
    const tokens = createTokenData({
      expiry_date: Date.now() - 1000,
    });

    await expect(
      tokenRefreshManager.refreshIfNeeded(client, 'user-fail', tokens),
    ).rejects.toThrow('Invalid grant');
  });

  it('reports stats about active refreshes', () => {
    const stats = tokenRefreshManager.getStats();
    expect(stats).toHaveProperty('activeRefreshes');
    expect(stats).toHaveProperty('userIds');
    expect(Array.isArray(stats.userIds)).toBe(true);
  });

  it('preserves refresh_token from original when not provided in response', async () => {
    const client = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: {
          access_token: 'new-access',
          refresh_token: null, // no new refresh token
          expiry_date: Date.now() + 3600000,
        },
      }),
    } as unknown as OAuth2Client;

    const tokens = createTokenData({
      expiry_date: Date.now() - 1000,
      refresh_token: 'original-refresh-token',
    });

    const result = await tokenRefreshManager.refreshIfNeeded(client, 'user-preserve', tokens);

    expect(result.refresh_token).toBe('original-refresh-token');
  });
});
