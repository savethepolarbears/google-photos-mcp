import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { JWKS } from "oidc-provider";
import { AuthorizationStore } from "../../src/remote/authorization-store.js";
import { createRemoteServer } from "../../src/remote/server.js";

describe("remote server integration", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  it("requires HTTPS from a trusted proxy, valid Host, and a bearer token on every MCP method", async () => {
    const dir = mkdtempSync(path.join(process.cwd(), "remote-server-test-")); dirs.push(dir);
    const store = new AuthorizationStore(path.join(dir, "auth.db"));
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwks = { keys: [{ ...privateKey.export({ format: "jwk" }), kid: "test", use: "sig", alg: "RS256" }] } as JWKS;
    const server = createRemoteServer({ origin: "https://photos.example.test", hosts: ["photos.example.test"], origins: ["https://photos.example.test"], trustedProxies: ["loopback"], jwks, cookieKeys: ["x".repeat(32)], store });
    try {
      const get = (url: string) => request(server.app).get(url).set("Host", "photos.example.test");
      expect((await get("/.well-known/oauth-protected-resource/mcp")).status).toBe(400);
      const discovery = await get("/.well-known/oauth-protected-resource/mcp").set("X-Forwarded-Proto", "https");
      expect(discovery.status).toBe(200);
      expect(discovery.body.resource).toBe("https://photos.example.test/mcp");
      expect((await request(server.app).get("/mcp").set("Host", "evil.test").set("X-Forwarded-Proto", "https")).status).toBe(403);
      for (const method of ["get", "post", "delete"] as const) {
        const response = await request(server.app)[method]("/mcp").set("Host", "photos.example.test").set("X-Forwarded-Proto", "https");
        expect(response.status).toBe(401);
        expect(response.headers["www-authenticate"]).toContain("resource_metadata=");
      }
    } finally { await server.close(); store.close(); }
  });
});
