import { describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { JWKS } from "oidc-provider";

vi.mock("../../src/remote/google-identity.js", () => ({
  googleAuthorizationUrl: (state: string, nonce: string) => `https://accounts.google.test/?state=${state}&nonce=${nonce}`,
  exchangeGoogleCode: vi.fn(async () => ({ accountId: "google:alice", tokens: { userId: "google:alice" } })),
  saveGoogleCredentials: vi.fn(async () => {}),
}));
import { AuthorizationStore } from "../../src/remote/authorization-store.js";
import { createRemoteServer } from "../../src/remote/server.js";

describe("integrated remote authorization and MCP", () => {
  it("links an account through the interaction, grants consent, then initializes MCP and lists tools", async () => {
    const dir = mkdtempSync(path.join(process.cwd(), "remote-e2e-"));
    const store = new AuthorizationStore(path.join(dir, "auth.db"));
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwks = { keys: [{ ...privateKey.export({ format: "jwk" }), kid: "test", use: "sig", alg: "RS256" }] } as JWKS;
    const origin = "https://photos.example.test";
    const server = createRemoteServer({ origin, hosts: ["photos.example.test"], origins: [origin], trustedProxies: ["loopback"], jwks, cookieKeys: ["x".repeat(32)], store });
    const call = (method: "get" | "post", url: string) => request(server.app)[method](url).set("Host", "photos.example.test").set("X-Forwarded-Proto", "https");
    const cookies = new Map<string, string>();
    const remember = (headers: Record<string, unknown>) => {
      for (const item of (headers["set-cookie"] as string[] | undefined) ?? []) {
        const [pair] = item.split(";"), i = pair.indexOf("=");
        if (pair.slice(i + 1)) cookies.set(pair.slice(0, i), pair.slice(i + 1)); else cookies.delete(pair.slice(0, i));
      }
    };
    const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    try {
      const client = await call("post", "/reg").send({ redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
      expect(client.status).toBe(201);
      const verifier = "v".repeat(64);
      const query = new URLSearchParams({ client_id: client.body.client_id, redirect_uri: "https://client.example/cb", response_type: "code", scope: "photos", state: "client-state", resource: `${origin}/mcp`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
      let response = await call("get", `/auth?${query}`); remember(response.headers);
      const interaction = new URL(response.headers.location, origin);
      response = await call("get", interaction.pathname).set("Cookie", cookie()); remember(response.headers);
      let csrf = response.text.match(/name="csrf" value="([^"]+)"/)?.[1];
      expect(csrf).toBeTruthy();
      response = await call("post", `${interaction.pathname}/login`).set("Cookie", cookie()).set("Origin", origin).type("form").send({ csrf }); remember(response.headers);
      const googleState = new URL(response.headers.location).searchParams.get("state");
      response = await call("get", `/auth/callback?state=${googleState}&code=test`).set("Cookie", cookie()); remember(response.headers);
      response = await call("get", response.headers.location).set("Cookie", cookie()); remember(response.headers);
      for (let i = 0; i < 8 && response.headers.location && !response.headers.location.startsWith("https://client.example/"); i++) {
        const target = new URL(response.headers.location, origin);
        response = await call("get", target.pathname + target.search).set("Cookie", cookie()); remember(response.headers);
        if (response.status === 200 && response.text.includes('name="csrf"')) {
          csrf = response.text.match(/name="csrf" value="([^"]+)"/)?.[1];
          const action = response.text.match(/<form method="post" action="([^"]+)"/)?.[1];
          if (!action) throw new Error("Consent form action missing");
          response = await call("post", action).set("Cookie", cookie()).set("Origin", origin).type("form").send({ csrf, decision: "allow" }); remember(response.headers);
        }
      }
      const callback = new URL(response.headers.location);
      expect(callback.origin).toBe("https://client.example");
      const token = await call("post", "/token").type("form").send({ grant_type: "authorization_code", code: callback.searchParams.get("code"), code_verifier: verifier, client_id: client.body.client_id, redirect_uri: "https://client.example/cb", resource: `${origin}/mcp` });
      expect(token.status).toBe(200);
      const init = await call("post", "/mcp").set("Authorization", `Bearer ${token.body.access_token}`).set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      expect(init.status).toBe(200);
      const list = await call("post", "/mcp").set("Authorization", `Bearer ${token.body.access_token}`).set("mcp-session-id", init.headers["mcp-session-id"]).set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      expect(list.status).toBe(200);
      expect(list.text).toContain("search_photos");
    } finally { await server.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
