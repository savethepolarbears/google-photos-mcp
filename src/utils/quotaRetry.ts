import { quotaManager } from "./quotaManager.js";
import { withRetry } from "./retry.js";

/**
 * Retries an API request while checking and recording quota for every attempt.
 */
export function withQuotaRetry<T>(
  fn: () => Promise<T>,
  config: Parameters<typeof withRetry<T>>[1] = {},
  context: string = "operation",
  isMediaRequest: boolean = false,
): Promise<T> {
  return withRetry(
    async () => {
      quotaManager.checkQuota(isMediaRequest);
      quotaManager.recordRequest(isMediaRequest);
      return fn();
    },
    config,
    context,
  );
}
