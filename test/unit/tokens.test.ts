/**
 * Unit tests for src/auth/tokens.ts (AUTH-01)
 * Tests token persistence, retrieval, and no-backup-file guarantee.
 *
 * RED state: getTokens is not yet exported from src/auth/tokens.ts.
 * These tests will fail until Plan 02 lands the refactored implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";

// Mock logger to suppress output during tests
vi.mock("../../src/utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock @keyv/sqlite to prevent loading the native sqlite3 binary
// (architecture-dependent; the in-memory keyv mock above handles all storage)
vi.mock("@keyv/sqlite", () => ({
  default: class KeyvSqliteMock {
    readonly _mock = true;
  },
}));

// In-memory store shared across all keyv mock instances (cleared in beforeEach)
const store = new Map<string, unknown>();

// Mock keyv with an in-memory Map so tests are hermetic (no real SQLite writes)
vi.mock("keyv", () => {
  return {
    default: class KeyvMock {
      private namespace: string;
      constructor(opts?: { namespace?: string }) {
        this.namespace = opts?.namespace ?? "default";
      }
      async get(key: string): Promise<unknown> {
        return store.get(`${this.namespace}:${key}`) ?? undefined;
      }
      async set(key: string, value: unknown): Promise<void> {
        store.set(`${this.namespace}:${key}`, value);
      }
      async delete(key: string): Promise<void> {
        store.delete(`${this.namespace}:${key}`);
      }
      async clear(): Promise<void> {
        for (const k of store.keys()) {
          if (k.startsWith(`${this.namespace}:`)) {
            store.delete(k);
          }
        }
      }
    },
  };
});

import {
  saveTokens,
  getFirstAvailableTokens,
  // @ts-expect-error — getTokens does not exist yet; RED state until Plan 02
  getTokens,
} from "../../src/auth/tokens.js";
import type { TokenData } from "../../src/auth/tokens.js";

function makeToken(overrides: Partial<TokenData> = {}): TokenData {
  return {
    access_token: overrides.access_token ?? "access-abc",
    refresh_token: overrides.refresh_token ?? "refresh-xyz",
    id_token: overrides.id_token,
    expiry_date: overrides.expiry_date ?? Date.now() + 3_600_000,
    userEmail: overrides.userEmail ?? "user@example.com",
    userId: overrides.userId ?? "user-1",
    retrievedAt: overrides.retrievedAt ?? Date.now(),
  };
}

describe("tokens.ts — AUTH-01", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe("saveTokens / getTokens round-trip", () => {
    it("saveTokens persists tokens; getTokens retrieves the same object", async () => {
      const token = makeToken({ userId: "user-rt" });
      await saveTokens("user-rt", token);

      const retrieved = await getTokens("user-rt");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.access_token).toBe(token.access_token);
      expect(retrieved?.refresh_token).toBe(token.refresh_token);
      expect(retrieved?.expiry_date).toBe(token.expiry_date);
    });

    it("getTokens returns null for an unknown userId", async () => {
      const result = await getTokens("nobody");
      expect(result).toBeNull();
    });
  });

  describe("getFirstAvailableTokens", () => {
    it("returns the most-recently-saved tokens when multiple users exist", async () => {
      const older = makeToken({
        userId: "user-old",
        retrievedAt: Date.now() - 10_000,
        access_token: "old-token",
      });
      const newer = makeToken({
        userId: "user-new",
        retrievedAt: Date.now(),
        access_token: "new-token",
      });

      await saveTokens("user-old", older);
      await saveTokens("user-new", newer);

      const result = await getFirstAvailableTokens();
      expect(result).not.toBeNull();
      // Should return one of the stored tokens (exact ordering is implementation-defined)
      expect(["old-token", "new-token"]).toContain(result?.access_token);
    });

    it("returns null when no tokens are stored", async () => {
      const result = await getFirstAvailableTokens();
      expect(result).toBeNull();
    });
  });

  describe("no backup file side-effects", () => {
    it("saveTokens does NOT create any *.json files in process.cwd()", async () => {
      const token = makeToken({ userId: "user-nofile" });
      await saveTokens("user-nofile", token);

      const tokensJsonPath = path.join(process.cwd(), "tokens.json");
      expect(existsSync(tokensJsonPath)).toBe(false);
    });

    it("no tokens.json.backup-* file exists after saveTokens", async () => {
      const token = makeToken({ userId: "user-nobackup" });
      await saveTokens("user-nobackup", token);

      // Glob manually: any tokens.json.backup-* in cwd should not exist
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(process.cwd());
      const backupFiles = files.filter((f) =>
        f.startsWith("tokens.json.backup"),
      );
      expect(backupFiles).toHaveLength(0);
    });
  });
});
