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
        store.forEach((_, k) => {
          if (k.startsWith(`${this.namespace}:`)) {
            store.delete(k);
          }
        });
      }
    },
  };
});

import childProcess from "node:child_process";
import Keyv from "keyv";
import {
  saveTokens,
  getFirstAvailableTokens,
  getTokens,
  enforceOwnerOnlyPermissions,
  enforceWindowsOwnerOnlyAcl,
  parseWindowsNonOwnerAces,
  precreateAndHardenTokenStorage,
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

    it("serializes concurrent saveTokens calls so writes execute sequentially", async () => {
      const callLog: string[] = [];
      const originalSet = Keyv.prototype.set;

      let resolveFirstSet: () => void = () => {};
      const firstSetBlocker = new Promise<void>((resolve) => {
        resolveFirstSet = resolve;
      });

      let callCount = 0;
      const setSpy = vi
        .spyOn(Keyv.prototype, "set")
        .mockImplementation(async function (
          this: unknown,
          key: string,
          value: unknown,
        ) {
          callCount++;
          const current = callCount;
          callLog.push(`start-${current}`);
          if (current === 1) {
            // Block the first write until explicitly resolved
            await firstSetBlocker;
          }
          callLog.push(`end-${current}`);
          return originalSet.call(this, key, value);
        });

      try {
        const token1 = makeToken({ userId: "user-concurrent-1" });
        const token2 = makeToken({ userId: "user-concurrent-2" });

        // Trigger both writes concurrently
        const promise1 = saveTokens("user-concurrent-1", token1);
        const promise2 = saveTokens("user-concurrent-2", token2);

        // Yield event loop
        await new Promise((resolve) => setTimeout(resolve, 20));

        // With serialization, write 2 must NOT have started yet while write 1 is blocked!
        expect(callLog).toEqual(["start-1"]);

        // Unblock the first write
        resolveFirstSet();

        await Promise.all([promise1, promise2]);

        // Write 1 starts, ends, then write 2 starts, ends
        expect(callLog).toEqual(["start-1", "end-1", "start-2", "end-2"]);
      } finally {
        setSpy.mockRestore();
      }
    });

    it("executes queued saveTokens even if previous saveTokens rejected", async () => {
      let failFirst = true;
      const originalSet = Keyv.prototype.set;
      const setSpy = vi
        .spyOn(Keyv.prototype, "set")
        .mockImplementation(async function (
          this: unknown,
          key: string,
          value: unknown,
        ) {
          if (failFirst) {
            failFirst = false;
            throw new Error("Simulated token write failure");
          }
          return originalSet.call(this, key, value);
        });

      try {
        const token1 = makeToken({ userId: "user-fail" });
        const token2 = makeToken({ userId: "user-succeed" });

        await expect(saveTokens("user-fail", token1)).rejects.toThrow(
          "Simulated token write failure",
        );
        await expect(saveTokens("user-succeed", token2)).resolves.not.toThrow();
      } finally {
        setSpy.mockRestore();
      }
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

  describe("enforceOwnerOnlyPermissions", () => {
    it("restricts permissions to 0600 on file and sidecars", async () => {
      const fs = await import("node:fs/promises");
      const tmpDir = await fs.mkdtemp(path.join(process.cwd(), "test-perms-"));
      const dbFile = path.join(tmpDir, "test.db");
      const walFile = path.join(tmpDir, "test.db-wal");
      const shmFile = path.join(tmpDir, "test.db-shm");
      const journalFile = path.join(tmpDir, "test.db-journal");

      await fs.writeFile(dbFile, "db-content", { mode: 0o644 });
      await fs.writeFile(walFile, "wal-content", { mode: 0o644 });
      await fs.writeFile(shmFile, "shm-content", { mode: 0o644 });
      await fs.writeFile(journalFile, "journal-content", { mode: 0o644 });

      enforceOwnerOnlyPermissions(dbFile);

      if (process.platform !== "win32") {
        const dbStats = await fs.stat(dbFile);
        const walStats = await fs.stat(walFile);
        const shmStats = await fs.stat(shmFile);
        const journalStats = await fs.stat(journalFile);

        expect(dbStats.mode & 0o777).toBe(0o600);
        expect(walStats.mode & 0o777).toBe(0o600);
        expect(shmStats.mode & 0o777).toBe(0o600);
        expect(journalStats.mode & 0o777).toBe(0o600);
      }

      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("handles non-existent sidecar files gracefully", () => {
      expect(() => {
        enforceOwnerOnlyPermissions("/path/to/nonexistent/db.sqlite");
      }).not.toThrow();
    });

    it("throws if chmodSync fails to enforce 0600 permissions on non-Windows", async () => {
      if (process.platform === "win32") return;
      const fsPromises = await import("node:fs/promises");
      const fsSync = await import("node:fs");
      const tmpDir = await fsPromises.mkdtemp(
        path.join(process.cwd(), "test-chmod-fail-"),
      );
      const testFile = path.join(tmpDir, "test.db");
      await fsPromises.writeFile(testFile, "data", { mode: 0o644 });

      const chmodSpy = vi
        .spyOn(fsSync.default, "chmodSync")
        .mockImplementation(() => {
          throw new Error("EPERM: operation not permitted");
        });

      try {
        expect(() => enforceOwnerOnlyPermissions(testFile)).toThrow(
          "Could not enforce 0600 permissions",
        );
      } finally {
        chmodSpy.mockRestore();
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("does not alter permissions of an existing directory when hardening token files", async () => {
      const fs = await import("node:fs/promises");
      const tmpDir = await fs.mkdtemp(
        path.join(process.cwd(), "test-dir-perms-"),
      );
      if (process.platform !== "win32") {
        await fs.chmod(tmpDir, 0o755);
        const statsBefore = await fs.stat(tmpDir);
        expect(statsBefore.mode & 0o777).toBe(0o755);

        const dbFile = path.join(tmpDir, "tokens.db");
        await fs.writeFile(dbFile, "data", { mode: 0o644 });
        enforceOwnerOnlyPermissions(dbFile);

        const statsAfter = await fs.stat(tmpDir);
        expect(statsAfter.mode & 0o777).toBe(0o755);
        const fileStats = await fs.stat(dbFile);
        expect(fileStats.mode & 0o777).toBe(0o600);
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("enforces owner-only ACL on Windows using icacls.exe", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalUsername = process.env.USERNAME;
      const originalUser = process.env.USER;
      process.env.USERNAME = "testwinuser";

      try {
        enforceWindowsOwnerOnlyAcl("C:\\token-storage\\tokens.db");
        expect(execSpy).toHaveBeenNthCalledWith(
          1,
          "icacls.exe",
          [
            "C:\\token-storage\\tokens.db",
            "/inheritance:r",
            "/grant:r",
            "testwinuser:(F)",
          ],
          { stdio: "ignore" },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          2,
          "icacls.exe",
          ["C:\\token-storage\\tokens.db"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } finally {
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        process.env.USER = originalUser;
      }
    });

    it("removes non-owner explicit ACEs when discovered in icacls query", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValueOnce(Buffer.from(""))
        .mockReturnValueOnce(
          Buffer.from(
            "C:\\token-storage\\tokens.db testwinuser:(F)\r\n" +
              "                           DOMAIN\\OtherUser:(R)\r\n" +
              "                           BUILTIN\\Users:(M)\r\n" +
              "Successfully processed 1 files; Failed processing 0 files\r\n",
          ),
        )
        .mockReturnValue(Buffer.from(""));

      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      try {
        enforceWindowsOwnerOnlyAcl("C:\\token-storage\\tokens.db");
        expect(execSpy).toHaveBeenCalledTimes(4);
        expect(execSpy).toHaveBeenNthCalledWith(
          1,
          "icacls.exe",
          [
            "C:\\token-storage\\tokens.db",
            "/inheritance:r",
            "/grant:r",
            "testwinuser:(F)",
          ],
          { stdio: "ignore" },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          2,
          "icacls.exe",
          ["C:\\token-storage\\tokens.db"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          3,
          "icacls.exe",
          ["C:\\token-storage\\tokens.db", "/remove", "DOMAIN\\OtherUser"],
          { stdio: "ignore" },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          4,
          "icacls.exe",
          ["C:\\token-storage\\tokens.db", "/remove", "BUILTIN\\Users"],
          { stdio: "ignore" },
        );
      } finally {
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
      }
    });

    it("parses non-owner ACEs accurately from icacls output", () => {
      const sample =
        "C:\\tokens.db DOMAIN\\testwinuser:(F)\r\n" +
        "             NT AUTHORITY\\SYSTEM:(F)\r\n" +
        "             BUILTIN\\Users:(R)\r\n" +
        "             testwinuser:(F)\r\n" +
        "Successfully processed 1 files;\r\n";

      const nonOwners = parseWindowsNonOwnerAces(
        sample,
        "testwinuser",
        "C:\\tokens.db",
      );
      expect(nonOwners).toEqual(["NT AUTHORITY\\SYSTEM", "BUILTIN\\Users"]);
    });

    it("enforces inheritance container/object owner-only ACL on Windows for directories", async () => {
      const fsPromises = await import("node:fs/promises");
      const tmpDir = await fsPromises.mkdtemp(
        path.join(process.cwd(), "test-win-dir-"),
      );
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      try {
        enforceWindowsOwnerOnlyAcl(tmpDir);
        expect(execSpy).toHaveBeenNthCalledWith(
          1,
          "icacls.exe",
          [tmpDir, "/inheritance:r", "/grant:r", "testwinuser:(OI)(CI)(F)"],
          { stdio: "ignore" },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          2,
          "icacls.exe",
          [tmpDir],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } finally {
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("throws if icacls.exe fails on Windows", () => {
      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockImplementation(() => {
          throw new Error("Access is denied");
        });
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      try {
        expect(() =>
          enforceWindowsOwnerOnlyAcl("C:\\token-storage\\tokens.db"),
        ).toThrow(
          "Could not enforce owner-only ACL on Windows for C:\\token-storage\\tokens.db: Access is denied",
        );
      } finally {
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
      }
    });

    it("throws if Windows username cannot be determined", () => {
      const originalUsername = process.env.USERNAME;
      const originalUser = process.env.USER;
      delete process.env.USERNAME;
      delete process.env.USER;

      try {
        expect(() =>
          enforceWindowsOwnerOnlyAcl("C:\\token-storage\\tokens.db"),
        ).toThrow("Could not determine Windows username");
      } finally {
        process.env.USERNAME = originalUsername;
        process.env.USER = originalUser;
      }
    });

    it("enforceOwnerOnlyPermissions invokes enforceWindowsOwnerOnlyAcl when platform is win32", async () => {
      const fsPromises = await import("node:fs/promises");
      const tmpDir = await fsPromises.mkdtemp(
        path.join(process.cwd(), "test-win-enforce-"),
      );
      const testDb = path.join(tmpDir, "tokens.db");
      await fsPromises.writeFile(testDb, "dummy-sqlite");

      const execSpy = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(Buffer.from(""));
      const originalPlatform = process.platform;
      const originalUsername = process.env.USERNAME;
      process.env.USERNAME = "testwinuser";

      try {
        Object.defineProperty(process, "platform", { value: "win32" });
        enforceOwnerOnlyPermissions(testDb);
        expect(execSpy).toHaveBeenNthCalledWith(
          1,
          "icacls.exe",
          [testDb, "/inheritance:r", "/grant:r", "testwinuser:(F)"],
          { stdio: "ignore" },
        );
        expect(execSpy).toHaveBeenNthCalledWith(
          2,
          "icacls.exe",
          [testDb],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
        execSpy.mockRestore();
        process.env.USERNAME = originalUsername;
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("precreateAndHardenTokenStorage", () => {
    it("pre-creates database and sidecars (-journal, -wal, -shm) with 0600 permissions", async () => {
      const fsPromises = await import("node:fs/promises");
      const tmpDir = await fsPromises.mkdtemp(
        path.join(process.cwd(), "test-precreate-"),
      );
      const testDb = path.join(tmpDir, "tokens.db");
      const journalFile = `${testDb}-journal`;
      const walFile = `${testDb}-wal`;
      const shmFile = `${testDb}-shm`;

      try {
        precreateAndHardenTokenStorage(testDb);

        expect(existsSync(testDb)).toBe(true);
        expect(existsSync(journalFile)).toBe(true);
        expect(existsSync(walFile)).toBe(true);
        expect(existsSync(shmFile)).toBe(true);

        if (process.platform !== "win32") {
          const dbStat = await fsPromises.stat(testDb);
          const journalStat = await fsPromises.stat(journalFile);
          const walStat = await fsPromises.stat(walFile);
          const shmStat = await fsPromises.stat(shmFile);

          expect(dbStat.mode & 0o777).toBe(0o600);
          expect(journalStat.mode & 0o777).toBe(0o600);
          expect(walStat.mode & 0o777).toBe(0o600);
          expect(shmStat.mode & 0o777).toBe(0o600);
        }
      } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("pre-creates missing sidecars when database file already exists", async () => {
      const fsPromises = await import("node:fs/promises");
      const tmpDir = await fsPromises.mkdtemp(
        path.join(process.cwd(), "test-precreate-exist-"),
      );
      const testDb = path.join(tmpDir, "tokens.db");
      await fsPromises.writeFile(testDb, "existing-sqlite-data", { mode: 0o600 });

      try {
        precreateAndHardenTokenStorage(testDb);

        expect(existsSync(`${testDb}-journal`)).toBe(true);
        expect(existsSync(`${testDb}-wal`)).toBe(true);
        expect(existsSync(`${testDb}-shm`)).toBe(true);
      } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
