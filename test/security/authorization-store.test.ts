import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { AuthorizationStore } from "../../src/remote/authorization-store.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("authorization persistence", () => {
  it("persists, consumes, expires and revokes models by grant", async () => {
    const dir = mkdtempSync(path.join(process.cwd(), "auth-test-"));
    dirs.push(dir);
    const file = path.join(dir, "authorization.db");
    let store = new AuthorizationStore(file);
    let code = store.adapter("AuthorizationCode");
    const access = store.adapter("AccessToken");
    await code.upsert("code", { grantId: "grant", uid: "uid" }, 60);
    await access.upsert("access", { grantId: "grant", accountId: "user" }, 60);
    await code.upsert("expired", {}, 0);
    expect(await code.find("expired")).toBeUndefined();
    await code.consume("code");
    await expect(code.consume("code")).rejects.toThrow("already consumed");
    await expect(code.consume("expired")).rejects.toThrow("expired");
    expect((await code.findByUid("uid"))?.consumed).toBeTypeOf("number");
    store.close();
    store = new AuthorizationStore(file);
    code = store.adapter("AuthorizationCode");
    expect((await code.find("code"))?.consumed).toBeTypeOf("number");
    expect((await store.adapter("AccessToken").find("access"))?.accountId).toBe("user");
    await code.revokeByGrantId("grant");
    expect(await code.find("code")).toBeUndefined();
    expect(await store.adapter("AccessToken").find("access")).toBeUndefined();
    store.close();
  });
});
