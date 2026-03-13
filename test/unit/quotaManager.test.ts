/**
 * Unit tests for src/utils/quotaManager.ts
 * Tests quota tracking, limits, reset logic, and statistics.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';


// We need to test a fresh instance each time, so we import the class pattern
// and create instances manually rather than using the singleton.

// The QuotaManager class is not exported directly, but we can test via the
// module by re-importing or creating a local implementation for testing.
// Since the class itself is not exported, we'll test the singleton behavior
// with mocked Date.now() to control time.

describe('QuotaManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let quotaManager: any;

  beforeEach(async () => {
    // Import the singleton — it resets on module re-eval in test mode
    const mod = await import('../../src/utils/quotaManager.js');
    quotaManager = mod.quotaManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkQuota passes when under limit', () => {
    // Fresh manager should be well under limits
    expect(() => quotaManager.checkQuota(false)).not.toThrow();
  });

  it('recordRequest increments request count', () => {
    const statsBefore = quotaManager.getStats();
    quotaManager.recordRequest(false);
    const statsAfter = quotaManager.getStats();
    expect(statsAfter.requests.used).toBe(statsBefore.requests.used + 1);
  });

  it('recordRequest increments media byte count for media requests', () => {
    const statsBefore = quotaManager.getStats();
    quotaManager.recordRequest(true);
    const statsAfter = quotaManager.getStats();
    expect(statsAfter.mediaBytes.used).toBe(statsBefore.mediaBytes.used + 1);
  });

  it('getStats returns correct utilization percentage', () => {
    const stats = quotaManager.getStats();
    expect(stats.requests.utilizationPercent).toBeGreaterThanOrEqual(0);
    expect(stats.requests.utilizationPercent).toBeLessThanOrEqual(100);
    expect(stats.requests.remaining).toBe(stats.requests.max - stats.requests.used);
  });

  it('getStats includes reset time as ISO string', () => {
    const stats = quotaManager.getStats();
    expect(stats.resetTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('checkQuota resets counters after midnight UTC', () => {
    // Record some requests
    quotaManager.recordRequest(false);
    quotaManager.recordRequest(false);
    const statsBefore = quotaManager.getStats();
    expect(statsBefore.requests.used).toBeGreaterThan(0);

    // Mock Date.now to be past midnight UTC tomorrow
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
    vi.spyOn(Date, 'now').mockReturnValue(tomorrow.getTime());

    // checkQuota should reset the counters
    quotaManager.checkQuota(false);
    const statsAfter = quotaManager.getStats();
    // After reset, the count should be 0 (or very low if a single request was added)
    expect(statsAfter.requests.used).toBe(0);
  });
});
