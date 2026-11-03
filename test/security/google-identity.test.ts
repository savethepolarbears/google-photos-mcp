import { describe, expect, it } from "vitest";
import { verifiedAccountId } from "../../src/remote/google-identity.js";

describe("Google account binding", () => {
  it("uses the verified stable subject when the nonce matches", () => {
    expect(verifiedAccountId({ sub: "123", nonce: "random-nonce" }, "random-nonce"))
      .toBe("google:123");
  });

  it("rejects absent identities, nonce mismatches and empty nonces", () => {
    for (const [payload, nonce] of [
      [null, "a"], [{ sub: "123" }, "a"], [{ sub: "123", nonce: "b" }, "a"],
      [{ sub: "123", nonce: "longer" }, "a"], [{ sub: "", nonce: "a" }, "a"],
      [{ sub: "123", nonce: "" }, ""],
    ] as const) {
      expect(() => verifiedAccountId(payload, nonce)).toThrow();
    }
  });
});
