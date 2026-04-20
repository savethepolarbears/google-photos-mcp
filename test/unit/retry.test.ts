/**
 * Unit tests for src/utils/retry.ts
 * Tests retry logic, exponential backoff, error classification, and delay calculation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockAxiosError,
  createMockNetworkError,
} from "../helpers/mocks.js";

// Mock the logger to suppress output during tests
vi.mock("../../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock setTimeout to avoid actual delays
vi.useFakeTimers();

describe("withRetry", () => {
  let withRetry: typeof import("../../src/utils/retry.js").withRetry;

  beforeEach(async () => {
    const mod = await import("../../src/utils/retry.js");
    withRetry = mod.withRetry;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("returns result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const promise = withRetry(fn, { maxRetries: 3 }, "test op");
    // Advance timers to handle any internal delays
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 server error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(createMockAxiosError(500, "Internal Server Error"))
      .mockResolvedValue("recovered");

    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100 },
      "test op",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(createMockAxiosError(429, "Too Many Requests"))
      .mockResolvedValue("ok");

    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100, rateLimitDelayMs: 200 },
      "test op",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network error (no response)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(createMockNetworkError())
      .mockResolvedValue("back online");

    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100 },
      "test op",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("back online");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 404 client error", async () => {
    const fn = vi.fn().mockImplementation(() => {
      return Promise.reject(createMockAxiosError(404, "Not Found"));
    });

    // Attach .rejects handler BEFORE advancing timers to catch the rejection
    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100 },
      "test op",
    );
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 403 permission denied", async () => {
    const fn = vi.fn().mockImplementation(() => {
      return Promise.reject(createMockAxiosError(403, "PERMISSION_DENIED"));
    });

    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100 },
      "test op",
    );
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on non-Axios errors", async () => {
    const fn = vi.fn().mockImplementation(() => {
      return Promise.reject(new Error("Some internal error"));
    });

    const promise = withRetry(
      fn,
      { maxRetries: 3, initialDelayMs: 100 },
      "test op",
    );
    const assertion = expect(promise).rejects.toThrow("Some internal error");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts all retries and throws last error", async () => {
    const fn = vi.fn().mockImplementation(() => {
      return Promise.reject(createMockAxiosError(503, "Service Unavailable"));
    });

    const promise = withRetry(
      fn,
      { maxRetries: 2, initialDelayMs: 100 },
      "test op",
    );
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("uses default config when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const promise = withRetry(fn);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
  });
});
