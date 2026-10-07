import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAxiosError } from "../helpers/mocks.js";

vi.mock("../../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/utils/quotaManager.js", () => ({
  quotaManager: {
    checkQuota: vi.fn(),
    recordRequest: vi.fn(),
  },
}));

vi.useFakeTimers();

describe("withQuotaRetry", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("checks and records quota for every failed request attempt", async () => {
    const { quotaManager } = await import("../../src/utils/quotaManager.js");
    const { withQuotaRetry } = await import("../../src/utils/quotaRetry.js");
    const request = vi
      .fn()
      .mockRejectedValue(createMockAxiosError(503, "Service Unavailable"));

    const promise = withQuotaRetry(
      request,
      { maxRetries: 2, initialDelayMs: 0 },
      "test request",
    );
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    expect(request).toHaveBeenCalledTimes(3);
    expect(quotaManager.checkQuota).toHaveBeenCalledTimes(3);
    expect(quotaManager.recordRequest).toHaveBeenCalledTimes(3);
  });
});
