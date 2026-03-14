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
            return JSON.parse(row.value) as TokenData;
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
