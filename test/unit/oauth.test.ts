/**
 * Unit tests for src/api/oauth.ts — getAuthorizedHeaders
 *
 * Regression test for a bug where google-auth-library v10's
 * OAuth2Client.getRequestHeaders() returns a native Headers instance rather
 * than a plain object. Headers doesn't expose its entries as own enumerable
 * properties, so Object.entries(headers) silently returns [], and every
 * authenticated request was sent with no Authorization header at all.
 */

import { describe, it, expect } from "vitest";
import type { OAuth2Client } from "google-auth-library";
import { getAuthorizedHeaders } from "../../src/api/oauth.js";

describe("getAuthorizedHeaders", () => {
  it("converts a native Headers instance into a plain record with the Authorization header intact", async () => {
    const fakeAuth = {
      getRequestHeaders: async () =>
        new Headers({ authorization: "Bearer test-token-123" }),
    } as unknown as OAuth2Client;

    const headers = await getAuthorizedHeaders(fakeAuth);

    expect(headers).toEqual({ authorization: "Bearer test-token-123" });
  });

  it("wraps errors thrown by the underlying auth client", async () => {
    const fakeAuth = {
      getRequestHeaders: async () => {
        throw new Error("refresh failed");
      },
    } as unknown as OAuth2Client;

    await expect(getAuthorizedHeaders(fakeAuth)).rejects.toThrow(
      "Authorization failed: refresh failed",
    );
  });
});
