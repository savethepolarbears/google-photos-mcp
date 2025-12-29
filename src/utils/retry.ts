import logger from './logger.js';
import { AxiosError } from 'axios';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Minimum delay for 429 errors in milliseconds (default: 30000) */
  rateLimitDelayMs?: number;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Determines if an error is retryable based on Google Photos API best practices
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  // Check if it's an Axios error
  if ('isAxiosError' in error && error.isAxiosError) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    // Retry 5xx server errors
    if (status && status >= 500 && status < 600) {
      return true;
    }

    // Retry 429 rate limit errors
    if (status === 429) {
      return true;
    }

    // Retry network errors (no response received)
    if (!axiosError.response && axiosError.code !== 'ECONNABORTED') {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay for next retry attempt using exponential backoff
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @param is429 - Whether this is a rate limit (429) error
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, config: Required<RetryConfig>, is429: boolean): number {
  // For rate limit errors, use minimum 30s delay
  if (is429) {
    return Math.max(config.rateLimitDelayMs, config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt));
  }

  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at maximum delay
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Wraps an async function with retry logic following Google Photos API best practices.
 *
 * Retry behavior:
 * - 5xx errors: Exponential backoff starting at 1s (max 3 retries)
 * - 429 rate limit: Minimum 30s delay (max 3 retries)
 * - Network errors: Exponential backoff (max 3 retries)
 * - Other errors: No retry
 *
 * @param fn - The async function to execute with retry
 * @param config - Retry configuration options
 * @param context - Context string for logging (e.g., "list albums")
 * @returns Promise resolving to the function result
 * @throws The last error if all retries exhausted
 *
 * @example
 * ```typescript
 * const albums = await withRetry(
 *   async () => await photosClient.albums.list({ pageSize: 50 }),
 *   { maxRetries: 3 },
 *   'list albums'
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
  context: string = 'operation'
): Promise<T> {
  const finalConfig: Required<RetryConfig> = {
    maxRetries: config.maxRetries ?? 3,
    initialDelayMs: config.initialDelayMs ?? 1000,
    maxDelayMs: config.maxDelayMs ?? 30000,
    backoffMultiplier: config.backoffMultiplier ?? 2,
    rateLimitDelayMs: config.rateLimitDelayMs ?? 30000,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const result = await fn();

      // Log successful retry
      if (attempt > 0) {
        logger.info(`${context} succeeded after ${attempt} ${attempt === 1 ? 'retry' : 'retries'}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!isRetryableError(error)) {
        logger.debug(`${context} failed with non-retryable error`);
        throw error;
      }

      // Check if we have retries left
      if (attempt === finalConfig.maxRetries) {
        logger.error(`${context} failed after ${finalConfig.maxRetries} retries`);
        throw error;
      }

      // Determine if this is a rate limit error
      const is429: boolean =
        error !== null &&
        typeof error === 'object' &&
        'isAxiosError' in error &&
        (error as AxiosError).response?.status === 429;

      // Calculate delay
      const delayMs = calculateDelay(attempt, finalConfig, is429);

      // Log retry attempt
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode =
        error &&
        typeof error === 'object' &&
        'isAxiosError' in error
          ? (error as AxiosError).response?.status
          : undefined;

      logger.warn(
        `${context} failed (attempt ${attempt + 1}/${finalConfig.maxRetries + 1})${
          statusCode ? ` with status ${statusCode}` : ''
        }. Retrying in ${delayMs}ms...`,
        { error: errorMessage }
      );

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
