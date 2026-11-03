import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import express from "express";
import type { JWKS } from "oidc-provider";
import { AuthorizationStore } from "../../src/remote/authorization-store.js";
import { createAuthorizationProvider } from "../../src/remote/authorization-provider.js";
import { registrationGuard } from "../../src/remote/registration-guard.js";
import { bearerAuth } from "../../src/remote/bearer-auth.js";

const issuer = "https://photos.example.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...privateKey.export({ format: "jwk" }), kid: "test", use: "sig", alg: "RS256" }] } as JWKS;

describe("authorization provider", () => {
  let dir: string;
  let store: AuthorizationStore;
  beforeEach(() => {
    dir = mkdtempSync(path.join(process.cwd(), "provider-test-"));
    store = new AuthorizationStore(path.join(dir, "provider.db"));
  });
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const provider = () => createAuthorizationProvider({ issuer, jwks, cookieKeys: ["x".repeat(32)], store });

  it("requires a secure origin and adequate cookie key length", () => {
    expect(() => createAuthorizationProvider({ issuer: "http://example.test", jwks, cookieKeys: ["x".repeat(32)], store })).toThrow();
    expect(() => createAuthorizationProvider({ issuer, jwks, cookieKeys: ["short"], store })).toThrow();
  });

  it("rejects registration metadata capable of server-side fetching and insecure redirects", async () => {
    const app = express();
    app.post("/reg", express.json({ limit: "16kb" }), registrationGuard(store), provider().callback());
    for (const metadata of [
      { redirect_uris: ["https://client.example/cb"], jwks_uri: "http://169.254.169.254/" },
      { redirect_uris: ["https://client.example/cb"], sector_identifier_uri: "https://internal.example/" },
      { redirect_uris: ["http://evil.example/cb"] },
      { redirect_uris: ["https://client.example/cb#fragment"] },
    ]) {
      expect((await request(app).post("/reg").send(metadata)).status).toBe(400);
    }
    expect((await request(app).post("/reg").send({ redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "none" })).status).toBe(201);
    expect(store.countClients()).toBe(1);
  });

  it("publishes discovery and registers a public client", async () => {
    const app = provider().callback();
    const discovery = await request(app).get("/.well-known/openid-configuration");
    expect(discovery.status).toBe(200);
    expect(discovery.body.issuer).toBe(issuer);
    expect(discovery.body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(discovery.body.registration_endpoint).toBe(`${issuer}/reg`);
    const registered = await request(app).post("/reg").send({
      redirect_uris: ["https://client.example.test/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(registered.status).toBe(201);
    expect(registered.body.client_id).toBeTypeOf("string");
    expect(registered.body.client_secret).toBeUndefined();
    const missingPkce = await request(app).get("/auth").query({
      client_id: registered.body.client_id,
      redirect_uri: "https://client.example.test/callback",
      response_type: "code",
      scope: "photos",
      state: "test-state",
    });
    expect(missingPkce.status).toBe(303);
    expect(new URL(missingPkce.headers.location).searchParams.get("error")).toBe("invalid_request");
  });

  it("exchanges a PKCE authorization code for resource-bound credentials", async () => {
    const oidc = provider();
    const app = express();
    // Test-only interaction: production must establish a verified Google identity
    // and require explicit user consent before calling interactionFinished.
    app.get("/interaction/:uid", async (req, res, next) => {
      try {
        const interaction = await oidc.interactionDetails(req, res);
        if (interaction.prompt.name === "login") {
          await oidc.interactionFinished(req, res, { login: { accountId: "test-account" } }, { mergeWithLastSubmission: false });
        } else {
          if (!interaction.session) throw new Error("Missing test interaction session");
          const grant = new oidc.Grant({ accountId: interaction.session.accountId, clientId: String(interaction.params.client_id) });
          if (interaction.prompt.details.missingOIDCScope) {
            grant.addOIDCScope((interaction.prompt.details.missingOIDCScope as string[]).join(" "));
          }
          for (const [resource, scopes] of Object.entries(interaction.prompt.details.missingResourceScopes ?? {})) {
            grant.addResourceScope(resource, (scopes as string[]).join(" "));
          }
          await oidc.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
        }
      } catch (error) { next(error); }
    });
    app.use(oidc.callback());
    const registered = await request(app).post("/reg").send({
      redirect_uris: ["https://client.example.test/callback"], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    });
    expect(registered.status).toBe(201);
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const cookies = new Map<string, string>();
    const remember = (headers: Record<string, unknown>) => {
      for (const cookie of (headers["set-cookie"] as string[] | undefined) ?? []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        if (pair.slice(index + 1)) cookies.set(pair.slice(0, index), pair.slice(index + 1));
        else cookies.delete(pair.slice(0, index));
      }
    };
    let response = await request(app).get("/auth").query({ client_id: registered.body.client_id,
      redirect_uri: "https://client.example.test/callback", response_type: "code", scope: "photos",
      state: "csrf-state", resource: `${issuer}/mcp`, code_challenge: challenge, code_challenge_method: "S256" });
    remember(response.headers);
    for (let i = 0; i < 8 && response.headers.location && !response.headers.location.startsWith("https://client.example.test/"); i++) {
      const location = new URL(response.headers.location, issuer);
      response = await request(app).get(location.pathname + location.search)
        .set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
      remember(response.headers);
    }
    expect(response.headers.location).toMatch(/^https:\/\/client\.example\.test\/callback/);
    const callback = new URL(response.headers.location);
    expect(callback.searchParams.get("state")).toBe("csrf-state");
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    const badVerifier = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code", code, code_verifier: "z".repeat(64),
      client_id: registered.body.client_id, redirect_uri: "https://client.example.test/callback", resource: `${issuer}/mcp`,
    });
    expect(badVerifier.status).toBe(400);
    expect(badVerifier.body.error).toBe("invalid_grant");
    const exchange = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: registered.body.client_id, redirect_uri: "https://client.example.test/callback", resource: `${issuer}/mcp`,
    });
    expect(exchange.status).toBe(200);
    const token = await oidc.AccessToken.find(exchange.body.access_token);
    expect(token?.accountId).toBe("test-account");
    expect(token?.aud).toBe(`${issuer}/mcp`);
    expect(exchange.body.refresh_token).toBeTypeOf("string");
    const protectedApp = express();
    protectedApp.use("/mcp", bearerAuth(oidc, issuer), (_req, res) => res.json(res.locals.mcpPrincipal));
    for (const method of ["get", "post", "delete"] as const) {
      const anonymous = await request(protectedApp)[method]("/mcp");
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers["www-authenticate"]).toContain("resource_metadata=");
      expect((await request(protectedApp)[method]("/mcp").set("Authorization", "Bearer malformed")).status).toBe(401);
      const authorized = await request(protectedApp)[method]("/mcp").set("Authorization", `Bearer ${exchange.body.access_token}`);
      expect(authorized.status).toBe(200);
      expect(authorized.body.accountId).toBe("test-account");
    }
    const refresh = await request(app).post("/token").type("form").send({
      grant_type: "refresh_token", refresh_token: exchange.body.refresh_token,
      client_id: registered.body.client_id, resource: `${issuer}/mcp`,
    });
    expect(refresh.status).toBe(200);
    expect(refresh.body.refresh_token).not.toBe(exchange.body.refresh_token);
    const refreshReplay = await request(app).post("/token").type("form").send({
      grant_type: "refresh_token", refresh_token: exchange.body.refresh_token,
      client_id: registered.body.client_id, resource: `${issuer}/mcp`,
    });
    expect(refreshReplay.status).toBe(400);
    expect(refreshReplay.body.error).toBe("invalid_grant");
    expect((await request(protectedApp).get("/mcp").set("Authorization", `Bearer ${exchange.body.access_token}`)).status).toBe(401);
    const replay = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: registered.body.client_id, redirect_uri: "https://client.example.test/callback", resource: `${issuer}/mcp`,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
  });
});
