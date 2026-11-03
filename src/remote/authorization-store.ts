import { DatabaseSync } from "node:sqlite";
import type { Adapter, AdapterPayload } from "oidc-provider";
import fs from "node:fs";
import path from "node:path";

/** Persistent oidc-provider state. The caller owns the database lifecycle. */
export class AuthorizationStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    const dir = path.dirname(path.resolve(filePath));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const mode = fs.statSync(dir).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new Error("OAuth storage directory must be private (0700)");
      }
    }
    const flags = fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW;
    const fd = fs.openSync(filePath, flags, 0o600);
    try {
      if (process.platform !== "win32") fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS oidc_models (
        type TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
        expires_at INTEGER, grant_id TEXT, user_code TEXT, uid TEXT,
        PRIMARY KEY(type, id)
      );
      CREATE INDEX IF NOT EXISTS oidc_grant ON oidc_models(grant_id);
      CREATE INDEX IF NOT EXISTS oidc_user_code ON oidc_models(type, user_code);
      CREATE INDEX IF NOT EXISTS oidc_uid ON oidc_models(type, uid);
    `);
  }

  adapter = (type: string): Adapter => ({
    upsert: async (id, payload, expiresIn) => {
      const expiresAt = expiresIn === undefined ? null : Date.now() + expiresIn * 1000;
      this.db.prepare(`INSERT INTO oidc_models(type,id,payload,expires_at,grant_id,user_code,uid)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET
        payload=excluded.payload, expires_at=excluded.expires_at,
        grant_id=excluded.grant_id, user_code=excluded.user_code, uid=excluded.uid`)
        .run(type, id, JSON.stringify(payload), expiresAt, payload.grantId ?? null,
          payload.userCode ?? null, payload.uid ?? null);
    },
    find: async (id) => this.lookup(type, "id", id),
    findByUserCode: async (userCode) => this.lookup(type, "user_code", userCode),
    findByUid: async (uid) => this.lookup(type, "uid", uid),
    consume: async (id) => {
      // A conditional update is required: two token requests may both load the
      // same unconsumed model before either request reaches this method.
      const result = this.db.prepare(`UPDATE oidc_models
        SET payload=json_set(payload, '$.consumed', ?)
        WHERE type=? AND id=? AND (expires_at IS NULL OR expires_at > ?)
          AND json_extract(payload, '$.consumed') IS NULL`)
        .run(Math.floor(Date.now() / 1000), type, id, Date.now());
      if (result.changes !== 1) {
        throw new Error("Authorization artifact already consumed or expired");
      }
    },
    destroy: async (id) => {
      this.db.prepare("DELETE FROM oidc_models WHERE type=? AND id=?").run(type, id);
    },
    revokeByGrantId: async (grantId) => {
      this.db.prepare("DELETE FROM oidc_models WHERE grant_id=?").run(grantId);
    },
  });

  private lookup(type: string, column: "id" | "user_code" | "uid", value: string): AdapterPayload | undefined {
    const row = this.db.prepare(`SELECT payload FROM oidc_models WHERE type=? AND ${column}=? AND
      (expires_at IS NULL OR expires_at > ?) LIMIT 1`).get(type, value, Date.now());
    return row ? JSON.parse(String(row.payload)) as AdapterPayload : undefined;
  }

  countClients(): number {
    const row = this.db.prepare("SELECT count(*) AS count FROM oidc_models WHERE type='Client'").get();
    return Number(row?.count ?? 0);
  }

  close(): void { this.db.close(); }
}
