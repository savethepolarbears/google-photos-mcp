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

export interface WindowsOwnerInfo {
  username?: string;
  qualifiedName?: string;
  sid?: string;
}

/**
 * Resolves the current Windows user identity (leaf username, domain-qualified principal, and optional SID).
 * Checks standard environment variables (USERNAME, USERDOMAIN, USER_SID) and queries whoami.exe if available.
 */
export function getWindowsCurrentOwnerInfo(): WindowsOwnerInfo {
  const leafUser = process.env.USERNAME || process.env.USER || "";
  let qualifiedName: string | undefined;
  let sid: string | undefined;

  if (process.env.USER_SID) {
    sid = process.env.USER_SID.trim();
  }

  if (process.env.USERDOMAIN && leafUser) {
    qualifiedName = `${process.env.USERDOMAIN}\\${leafUser}`;
  }

  // Attempt to resolve SID and qualifiedName via whoami.exe if explicitly requested
  if (
    (!sid || !qualifiedName) &&
    (process.env.MOCK_WINDOWS_WHOAMI === "true" ||
      process.env.RESOLVE_WINDOWS_SID === "true")
  ) {
    try {
      const whoamiOutput = childProcess.execFileSync(
        "whoami.exe",
        ["/user", "/fo", "csv", "/nh"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const whoamiText = String(whoamiOutput ?? "");
      const match = whoamiText.match(/"([^"]+)","([^"]+)"/);
      if (match) {
        if (!qualifiedName) qualifiedName = match[1].trim();
        if (!sid) sid = match[2].trim();
      }
    } catch {
      // ignore whoami failure
    }
  }

  return {
    username: leafUser,
    qualifiedName,
    sid,
  };
}

/**
 * Parses icacls stdout to extract non-owner identities that have explicit ACEs on the target.
 * Resolves current account and ACE identities by exact SID or fully qualified principal (DOMAIN\user)
 * rather than loose leaf username suffix matching to prevent accounts with identical leaf names
 * from different domains or local machines from retaining access.
 *
 * @param icaclsOutput - Output from `icacls.exe <path>`
 * @param owner - The active Windows username, fully qualified principal, SID, or WindowsOwnerInfo object
 * @param targetPath - Optional path to strip from the beginning of lines
 * @returns Array of non-owner identity strings
 */
export function parseWindowsNonOwnerAces(
  icaclsOutput: string | Buffer,
  owner: string | WindowsOwnerInfo,
  targetPath?: string,
): string[] {
  const text = Buffer.isBuffer(icaclsOutput)
    ? icaclsOutput.toString("utf8")
    : String(icaclsOutput ?? "");
  const lines = text.split(/\r?\n/);
  const nonOwnerIdentities = new Set<string>();

  let ownerInfo: WindowsOwnerInfo;
  if (typeof owner === "string") {
    const trimmed = owner.trim();
    if (trimmed.startsWith("S-1-") || trimmed.startsWith("*S-1-")) {
      ownerInfo = {
        username: "",
        sid: trimmed.replace(/^\*/, ""),
      };
    } else if (trimmed.includes("\\")) {
      ownerInfo = {
        qualifiedName: trimmed,
        username: trimmed.split("\\").pop() || trimmed,
      };
    } else {
      ownerInfo = {
        username: trimmed,
        qualifiedName: process.env.USERDOMAIN
          ? `${process.env.USERDOMAIN}\\${trimmed}`
          : undefined,
        sid: process.env.USER_SID,
      };
    }
  } else {
    ownerInfo = owner;
  }

  const normalizedOwnerUsername = ownerInfo.username?.toLowerCase();
  const normalizedQualifiedOwner = ownerInfo.qualifiedName?.toLowerCase();
  const normalizedOwnerSid = ownerInfo.sid?.toLowerCase().replace(/^\*/, "");

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("Successfully processed")) continue;

    if (targetPath && line.toLowerCase().startsWith(targetPath.toLowerCase())) {
      line = line.slice(targetPath.length).trim();
    }

    const aceMatches = line.matchAll(/([^\r\n:]+):\(/g);
    for (const m of aceMatches) {
      let identity = m[1].trim();
      if (
        targetPath &&
        identity.toLowerCase().startsWith(targetPath.toLowerCase())
      ) {
        identity = identity.slice(targetPath.length).trim();
      }
      const lower = identity.toLowerCase();
      const rawIdentitySid =
        lower.startsWith("*s-1-") || lower.startsWith("s-1-")
          ? lower.replace(/^\*/, "")
          : undefined;

      let isOwner = false;

      // 1. Check SID equality if identity is a SID
      if (rawIdentitySid) {
        if (normalizedOwnerSid) {
          isOwner = rawIdentitySid === normalizedOwnerSid;
        } else {
          // ACE is an explicit SID but owner SID is different or unknown
          isOwner = false;
        }
      } else if (lower.includes("\\")) {
        // 2. Check exact fully qualified principal (DOMAIN\user)
        if (normalizedQualifiedOwner) {
          isOwner = lower === normalizedQualifiedOwner;
        } else if (normalizedOwnerUsername && process.env.USERDOMAIN) {
          isOwner =
            lower ===
            `${process.env.USERDOMAIN.toLowerCase()}\\${normalizedOwnerUsername}`;
        } else {
          // Domain prefix present on ACE but cannot verify against owner domain
          isOwner = false;
        }
      } else {
        // 3. Unqualified identity (e.g. "alice")
        if (normalizedOwnerUsername) {
          isOwner = lower === normalizedOwnerUsername;
        }
      }

      if (!isOwner && identity.length > 0) {
        nonOwnerIdentities.add(identity);
      }
    }
  }

  return Array.from(nonOwnerIdentities);
}

/**
 * Inspects icacls output to detect if any explicit deny ACEs are present on the target.
 * In Windows ACLs, an explicit deny ACE takes precedence over group allow permissions.
 * Deny ACEs display as (DENY)(...) or (N) in icacls, and explicit ACEs lack the (I) inheritance flag.
 *
 * @param icaclsOutput - Output from `icacls.exe <path>`
 * @returns True if an explicit deny ACE is present.
 */
export function hasWindowsExplicitDenyAces(
  icaclsOutput: string | Buffer,
): boolean {
  const text = Buffer.isBuffer(icaclsOutput)
    ? icaclsOutput.toString("utf8")
    : String(icaclsOutput ?? "");
  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("Successfully processed")) continue;
    const aceMatches = line.matchAll(/([^\r\n:]+):((?:\([^)]+\))+)/g);
    for (const match of aceMatches) {
      const perms = match[2].toUpperCase();
      const isInherited = perms.includes("(I)");
      const isDeny = perms.includes("(DENY)") || perms.includes("(N)");
      if (isDeny && !isInherited) {
        return true;
      }
    }
  }
  return false;
}


/**
 * Enforces restrictive owner-only ACLs on Windows using icacls.exe.
 * Atomically strips inherited permissions, grants full control exclusively to the current user,
 * and removes any remaining non-owner explicit ACEs from pre-existing files or directories.
 *
 * @param targetPath - The path to the file or directory.
 */
export function enforceWindowsOwnerOnlyAcl(targetPath: string): void {
  const ownerInfo = getWindowsCurrentOwnerInfo();
  const username =
    ownerInfo.username || process.env.USERNAME || process.env.USER;
  if (!username && !ownerInfo.qualifiedName && !ownerInfo.sid) {
    throw new Error(
      `Could not determine Windows username to enforce owner-only ACL on ${targetPath}`,
    );
  }
  try {
    const isDir =
      fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const principalSpec = ownerInfo.sid
      ? `*${ownerInfo.sid}`
      : ownerInfo.qualifiedName || username;
    const permissionSpec = isDir
      ? `${principalSpec}:(OI)(CI)(F)`
      : `${principalSpec}:(F)`;

    // 1. Apply restrictive DACL atomically in a single invocation without resetting to inherited ACLs
    childProcess.execFileSync(
      "icacls.exe",
      [targetPath, "/inheritance:r", "/grant:r", permissionSpec],
      { stdio: "ignore" },
    );

    // 2. Query DACL to identify and explicitly remove any remaining non-owner explicit ACEs
    const output = childProcess.execFileSync("icacls.exe", [targetPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const nonOwnerIdentities = parseWindowsNonOwnerAces(
      output,
      ownerInfo,
      targetPath,
    );
    for (const nonOwnerId of nonOwnerIdentities) {
      childProcess.execFileSync(
        "icacls.exe",
        [targetPath, "/remove", nonOwnerId],
        { stdio: "ignore" },
      );
    }

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

/**
 * Pre-creates the SQLite database and all companion sidecar files (-journal, -wal, -shm)
 * with owner-only permissions (0600 on Unix, owner-only ACL on Windows) if they do not exist,
 * and enforces owner-only permissions across all of them.
 *
 * This ensures that before SQLite begins any write transaction, the rollback journal and
 * WAL sidecars already exist with secure owner-only permissions, preventing SQLite from
 * creating sidecar files with inherited directory ACLs in pre-existing shared directories.
 *
 * @param filePath - The path to the SQLite database file.
 */
export function precreateAndHardenTokenStorage(filePath: string): void {
  const files = [
    filePath,
    `${filePath}-journal`,
    `${filePath}-wal`,
    `${filePath}-shm`,
  ];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      try {
        const fd = fs.openSync(file, "w", 0o600);
        fs.closeSync(fd);
      } catch (err) {
        const msg = `Could not pre-create token storage file ${file}: ${err instanceof Error ? err.message : String(err)}`;
        logger.error(msg);
        throw new Error(msg, { cause: err });
      }
    }
  }

  enforceOwnerOnlyPermissions(filePath);
}

// Pre-create directory (0700 on Unix, owner-only ACL on Windows) and file + sidecars (0600 on Unix, owner-only ACL on Windows)
// before KeyvSqlite opens it to prevent permissive umask creation.
// Only enforce restrictive permissions when the directory is created specifically for token storage.
// Never alter permissions of pre-existing directories (e.g. project root or shared checkout).
if (config.tokens.dbPath) {
  const dir = path.dirname(config.tokens.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      try {
        enforceWindowsOwnerOnlyAcl(dir);
      } catch (err) {
        if (fs.existsSync(dir)) {
          try {
            fs.rmdirSync(dir);
          } catch {
            // best-effort cleanup
          }
        }
        throw err;
      }
    } else {
      try {
        fs.chmodSync(dir, 0o700);
      } catch (err) {
        if (fs.existsSync(dir)) {
          try {
            fs.rmdirSync(dir);
          } catch {
            // best-effort cleanup
          }
        }
        const msg = `Could not enforce 0700 permissions on newly created token directory ${dir}: ${err instanceof Error ? err.message : String(err)}`;
        logger.error(msg);
        throw new Error(msg, { cause: err });
      }
    }
  }
  try {
    precreateAndHardenTokenStorage(config.tokens.dbPath);
  } catch (err) {
    logger.error(
      `Failed to initialize secure token storage for ${config.tokens.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
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

// Mutex queue to serialize all token store writes.
// Ensures that precreateAndHardenTokenStorage and the SQLite write transaction
// execute atomically and sequentially. This prevents race conditions where overlapping writes
// in a shared directory could allow SQLite to delete a hardened sidecar (-journal) on commit
// and recreate it in a concurrent transaction with unhardened directory permissions.
let _tokenWriteQueue: Promise<void> = Promise.resolve();

/**
 * Save authentication tokens for a user to the local SQLite store.
 */
export async function saveTokens(
  userId: string,
  tokens: TokenData,
): Promise<void> {
  const writeTask = async () => {
    // Pre-create and harden all SQLite sidecars (-journal, -wal, -shm) BEFORE
    // starting the write transaction. In pre-existing shared directories (especially on Windows),
    // SQLite creates rollback journal or WAL files during writes with inherited directory ACLs
    // unless they are pre-created with owner-only ACLs before writing.
    precreateAndHardenTokenStorage(config.tokens.dbPath);

    await tokenStore.set(
      userId,
      JSON.stringify({ ...tokens, retrievedAt: Date.now() }),
    );
    _savedUserIds.add(userId);
    enforceOwnerOnlyPermissions(config.tokens.dbPath);
    logger.info(`Saved tokens for user ${userId}`);
  };

  const nextPromise = _tokenWriteQueue.then(writeTask, writeTask);
  _tokenWriteQueue = nextPromise.catch(() => {});
  await nextPromise;
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
