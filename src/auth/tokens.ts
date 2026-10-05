/**
 * Token storage using keyv + @keyv/sqlite.
 *
 * Security note: tokens are stored as plaintext JSON in a local SQLite file
 * (tokens.db). This is intentional for a single-user local MCP server — the
 * file is only readable by the OS user running the server. File-level
 * encryption is not applied; if stricter at-rest encryption is needed,
 * layer keyv-encrypted on top of this store.
 *
 * NEVER log token strings. NEVER commit tokens.db to git.
 */
import Keyv from "keyv";
import KeyvSqlite from "@keyv/sqlite";
import config from "../utils/config.js";
import fs from "fs";
import path from "path";
import childProcess from "child_process";
import logger from "../utils/logger.js";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expiry_date: number;
  userEmail?: string;
  userId?: string;
  retrievedAt?: number;
}

/**
 * Enforces restrictive owner-only ACLs on Windows using icacls.exe.
 * Strips inherited permissions and grants full control exclusively to the current user.
 *
 * @param targetPath - The path to the file or directory.
 */
export function enforceWindowsOwnerOnlyAcl(targetPath: string): void {
  const username = process.env.USERNAME || process.env.USER;
  if (!username) {
    throw new Error(
      `Could not determine Windows username to enforce owner-only ACL on ${targetPath}`,
    );
  }
  try {
    const isDir =
      fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const permissionSpec = isDir
      ? `${username}:(OI)(CI)(F)`
      : `${username}:(F)`;
    childProcess.execFileSync(
      "icacls.exe",
      [targetPath, "/inheritance:r", "/grant:r", permissionSpec],
      { stdio: "ignore" },
    );
    logger.debug(`Enforced Windows owner-only ACL on ${targetPath}`);
  } catch (err) {
    const msg = `Could not enforce owner-only ACL on Windows for ${targetPath}: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(msg);
    throw new Error(msg, { cause: err });
  }
}

/**
 * Enforces restrictive owner-only permissions (0600 on Unix, owner-only ACL on Windows)
 * on the SQLite database and any companion journaling files (-wal, -shm, -journal).
 *
 * @param filePath - The path to the SQLite database file.
 */
export function enforceOwnerOnlyPermissions(filePath: string): void {
  const filesToCheck = [
    filePath,
    `${filePath}-wal`,
    `${filePath}-shm`,
    `${filePath}-journal`,
  ];

  if (process.platform === "win32") {
    for (const file of filesToCheck) {
      if (fs.existsSync(file)) {
        enforceWindowsOwnerOnlyAcl(file);
      }
    }
    return;
  }

  for (const file of filesToCheck) {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      if ((stats.mode & 0o777) !== 0o600) {
        try {
          fs.chmodSync(file, 0o600);
          logger.debug(`Enforced 0600 permissions on ${file}`);
        } catch (err) {
          const msg = `Could not enforce 0600 permissions on ${file}: ${err instanceof Error ? err.message : String(err)}`;
          logger.error(msg);
          throw new Error(msg, { cause: err });
        }
      }
    }
  }
}

// Pre-create directory (0700 on Unix, owner-only ACL on Windows) and file (0600 on Unix, owner-only ACL on Windows)
// before KeyvSqlite opens it to prevent permissive umask creation.
// Only enforce restrictive permissions when the directory is created specifically for token storage.
// Never alter permissions of pre-existing directories (e.g. project root or shared checkout).
if (config.tokens.dbPath) {
  const dir = path.dirname(config.tokens.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      enforceWindowsOwnerOnlyAcl(dir);
    } else {
      try {
        fs.chmodSync(dir, 0o700);
      } catch (err) {
        const msg = `Could not enforce 0700 permissions on newly created token directory ${dir}: ${err instanceof Error ? err.message : String(err)}`;
        logger.error(msg);
        throw new Error(msg, { cause: err });
      }
    }
  }
  if (!fs.existsSync(config.tokens.dbPath)) {
    const fd = fs.openSync(config.tokens.dbPath, "w", 0o600);
    fs.closeSync(fd);
  }
  enforceOwnerOnlyPermissions(config.tokens.dbPath);
}

// Module-level singleton — one connection, reused across all calls.
// Namespace 'tokens' scopes all keys so future keyv namespaces don't collide.
const tokenStore = new Keyv<string>({
  store: new KeyvSqlite(`sqlite://${config.tokens.dbPath}`),
  namespace: "tokens",
});

// In-memory index of user IDs saved this process lifetime.
// Used as a fallback when the adapter lacks a query() method (e.g. in tests).
const _savedUserIds = new Set<string>();

if (typeof tokenStore.on === "function") {
  tokenStore.on("error", (err: Error) => {
    logger.error("keyv token store error:", err);
  });
}

/**
 * Save authentication tokens for a user to the local SQLite store.
 */
export async function saveTokens(
  userId: string,
  tokens: TokenData,
): Promise<void> {
  await tokenStore.set(
    userId,
    JSON.stringify({ ...tokens, retrievedAt: Date.now() }),
  );
  _savedUserIds.add(userId);
  enforceOwnerOnlyPermissions(config.tokens.dbPath);
  logger.info(`Saved tokens for user ${userId}`);
}

/**
 * Retrieve authentication tokens for a specific user.
 * Returns null if no tokens exist for that userId.
 */
export async function getTokens(userId: string): Promise<TokenData | null> {
  const raw = await tokenStore.get(userId);
  if (!raw) return null;
  return JSON.parse(raw) as TokenData;
}

/**
 * Return tokens for any stored user — sorted by retrievedAt descending.
 * Useful for single-user scenarios or when any valid credential will do.
 */
export async function getFirstAvailableTokens(): Promise<TokenData | null> {
  try {
    // Try the SQLite adapter's query() first (production path).
    const store = tokenStore as Keyv<string> & {
      opts?: {
        store?: {
          query?: (
            sql: string,
          ) => Promise<Array<{ key: string; value: string }>>;
        };
      };
    };
    const adapter = store.opts?.store;

    let parsed: TokenData[] = [];

    if (adapter && typeof adapter.query === "function") {
      // The @keyv/sqlite table is named after the namespace ("tokens").
      const rows: Array<{ key: string; value: string }> = await adapter.query(
        `SELECT key, value FROM keyv WHERE key LIKE 'tokens:%'`,
      );
      parsed = rows
        .map((row) => {
          try {
            // Keyv stores values as {"value": "{...}"} — need to unwrap
            const keyvWrapper = JSON.parse(row.value);
            const innerValue =
              typeof keyvWrapper === "object" && keyvWrapper?.value
                ? keyvWrapper.value
                : row.value;
            const tokenData =
              typeof innerValue === "string"
                ? (JSON.parse(innerValue) as TokenData)
                : (innerValue as TokenData);
            return tokenData;
          } catch {
            return null;
          }
        })
        .filter((t): t is TokenData => t !== null);
    } else if (_savedUserIds.size > 0) {
      // Fallback: iterate the in-memory user index (used in tests / non-SQLite adapters).
      const results = await Promise.all(
        [..._savedUserIds].map((uid) => getTokens(uid)),
      );
      parsed = results.filter((t): t is TokenData => t !== null);
    }

    if (parsed.length === 0) {
      logger.debug("No users with stored tokens found");
      return null;
    }

    // Return the most recently saved token.
    parsed.sort((a, b) => (b.retrievedAt ?? 0) - (a.retrievedAt ?? 0));
    return parsed[0];
  } catch (error) {
    logger.debug(
      `No tokens found or error retrieving tokens: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
