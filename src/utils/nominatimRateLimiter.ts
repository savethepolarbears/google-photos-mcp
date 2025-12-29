import logger from './logger.js';

/**
 * Rate limiter for Nominatim OpenStreetMap API.
 * Enforces 1 request per second limit per Nominatim's usage policy.
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */
export class NominatimRateLimiter {
  private lastRequestTime: number = 0;
  private readonly minIntervalMs: number;
  private requestQueue: Array<() => void> = [];
  private processing: boolean = false;

  /**
   * Creates a new Nominatim rate limiter.
   *
   * @param requestsPerSecond - Maximum requests per second (default: 1)
   */
  constructor(requestsPerSecond: number = 1) {
    // Add 100ms buffer to be safe (1100ms instead of 1000ms)
    this.minIntervalMs = (1000 / requestsPerSecond) + 100;
  }

  /**
   * Throttles execution of an async function to respect rate limits.
   *
   * @param fn - The async function to execute
   * @returns Promise resolving to the function result
   *
   * @example
   * ```typescript
   * const limiter = new NominatimRateLimiter();
   * const result = await limiter.throttle(async () => {
   *   return await axios.get('https://nominatim.openstreetmap.org/search?q=Paris');
   * });
   * ```
   */
  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      // Wait if we haven't waited long enough since the last request
      if (timeSinceLastRequest < this.minIntervalMs) {
        const delayMs = this.minIntervalMs - timeSinceLastRequest;
        logger.debug(`Nominatim rate limiter: waiting ${delayMs}ms before next request`);
        await this.sleep(delayMs);
      }

      const request = this.requestQueue.shift();
      if (request) {
        this.lastRequestTime = Date.now();
        await request();
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets statistics about the rate limiter state.
   */
  getStats(): { queueLength: number; lastRequestMs: number } {
    return {
      queueLength: this.requestQueue.length,
      lastRequestMs: this.lastRequestTime,
    };
  }
}

/**
 * Singleton instance of the Nominatim rate limiter.
 * Shared across all location API calls to ensure global rate limiting.
 */
export const nominatimRateLimiter = new NominatimRateLimiter(1);
