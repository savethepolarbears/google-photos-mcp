import logger from './logger.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Manages Google Photos API quota tracking.
 * Google Photos API limits: 10,000 requests/day, 75,000 media bytes/day
 *
 * @see https://developers.google.com/photos/overview/api-limits-quotas
 */
export class QuotaManager {
  private requestCount: number = 0;
  private mediaByteCount: number = 0;
  private resetTime: number;
  private readonly maxRequests: number;
  private readonly maxMediaBytes: number;

  /**
   * Creates a new quota manager.
   *
   * @param maxRequests - Maximum requests per day (default: 10000)
   * @param maxMediaBytes - Maximum media byte requests per day (default: 75000)
   */
  constructor(maxRequests: number = 10000, maxMediaBytes: number = 75000) {
    this.maxRequests = maxRequests;
    this.maxMediaBytes = maxMediaBytes;
    this.resetTime = this.getNextResetTime();
  }

  /**
   * Calculates the next midnight UTC (when quotas reset)
   */
  private getNextResetTime(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Resets quota counters if past reset time
   */
  private checkReset(): void {
    const now = Date.now();
    if (now >= this.resetTime) {
      logger.info('Resetting API quota counters', {
        previousRequests: this.requestCount,
        previousMediaBytes: this.mediaByteCount,
      });
      this.requestCount = 0;
      this.mediaByteCount = 0;
      this.resetTime = this.getNextResetTime();
    }
  }

  /**
   * Checks if a request would exceed quota limits.
   *
   * @param isMediaRequest - Whether this is a media byte request
   * @throws McpError if quota exceeded
   */
  checkQuota(isMediaRequest: boolean = false): void {
    this.checkReset();

    if (this.requestCount >= this.maxRequests) {
      const resetDate = new Date(this.resetTime).toISOString();
      logger.error('API quota exceeded', {
        requestCount: this.requestCount,
        maxRequests: this.maxRequests,
        resetTime: resetDate,
      });

      throw new McpError(
        ErrorCode.InternalError,
        `Google Photos API quota exceeded (${this.requestCount}/${this.maxRequests} requests). ` +
        `Quota resets at ${resetDate}. Please try again later.`
      );
    }

    if (isMediaRequest && this.mediaByteCount >= this.maxMediaBytes) {
      const resetDate = new Date(this.resetTime).toISOString();
      logger.error('Media byte quota exceeded', {
        mediaByteCount: this.mediaByteCount,
        maxMediaBytes: this.maxMediaBytes,
        resetTime: resetDate,
      });

      throw new McpError(
        ErrorCode.InternalError,
        `Google Photos media byte quota exceeded (${this.mediaByteCount}/${this.maxMediaBytes} requests). ` +
        `Quota resets at ${resetDate}. Please try again later.`
      );
    }
  }

  /**
   * Records a successful API request.
   *
   * @param isMediaRequest - Whether this was a media byte request
   */
  recordRequest(isMediaRequest: boolean = false): void {
    this.requestCount++;
    if (isMediaRequest) {
      this.mediaByteCount++;
    }

    // Log warning at 80% quota
    if (this.requestCount === Math.floor(this.maxRequests * 0.8)) {
      logger.warn('API quota at 80%', {
        requestCount: this.requestCount,
        maxRequests: this.maxRequests,
        remaining: this.maxRequests - this.requestCount,
      });
    }

    if (isMediaRequest && this.mediaByteCount === Math.floor(this.maxMediaBytes * 0.8)) {
      logger.warn('Media byte quota at 80%', {
        mediaByteCount: this.mediaByteCount,
        maxMediaBytes: this.maxMediaBytes,
        remaining: this.maxMediaBytes - this.mediaByteCount,
      });
    }
  }

  /**
   * Gets current quota statistics.
   */
  getStats(): {
    requests: { used: number; max: number; remaining: number; utilizationPercent: number };
    mediaBytes: { used: number; max: number; remaining: number; utilizationPercent: number };
    resetTime: string;
  } {
    this.checkReset();

    return {
      requests: {
        used: this.requestCount,
        max: this.maxRequests,
        remaining: this.maxRequests - this.requestCount,
        utilizationPercent: (this.requestCount / this.maxRequests) * 100,
      },
      mediaBytes: {
        used: this.mediaByteCount,
        max: this.maxMediaBytes,
        remaining: this.maxMediaBytes - this.mediaByteCount,
        utilizationPercent: (this.mediaByteCount / this.maxMediaBytes) * 100,
      },
      resetTime: new Date(this.resetTime).toISOString(),
    };
  }
}

/**
 * Singleton instance for global quota tracking
 */
export const quotaManager = new QuotaManager();
