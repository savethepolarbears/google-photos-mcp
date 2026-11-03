import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type Provider from "oidc-provider";
import { bearerAuth } from "../../src/remote/bearer-auth.js";

const origin = "https://photos.example.test";
const validToken = {
  aud: `${origin}/mcp`, accountId: "account-a", clientId: "client-a",
  grantId: "grant-a", scope: "photos", isExpired: false,
};
const validGrant = { accountId: "account-a", clientId: "client-a", isExpired: false };

function protectedApp(token: unknown, grant: unknown) {
  const provider = {
    AccessToken: { find: vi.fn().mockResolvedValue(token) },
    Grant: { find: vi.fn().mockResolvedValue(grant) },
  } as unknown as Provider;
  const app = express();
  app.use("/mcp", bearerAuth(provider, origin), (_req, res) => res.json(res.locals.mcpPrincipal));
  return app;
}

describe("remote bearer token enforcement", () => {
  const rejected = [
    ["unknown or revoked token", null, validGrant],
    ["expired token", { ...validToken, isExpired: true }, validGrant],
    ["wrong audience", { ...validToken, aud: "https://other.example/mcp" }, validGrant],
    ["missing photos scope", { ...validToken, scope: "openid" }, validGrant],
    ["missing account", { ...validToken, accountId: undefined }, validGrant],
    ["missing client", { ...validToken, clientId: undefined }, validGrant],
    ["missing grant", { ...validToken, grantId: undefined }, validGrant],
    ["revoked grant", validToken, null],
    ["expired grant", validToken, { ...validGrant, isExpired: true }],
    ["different grant account", validToken, { ...validGrant, accountId: "account-b" }],
    ["different grant client", validToken, { ...validGrant, clientId: "client-b" }],
    ["unverified proof-of-possession token", { ...validToken, jkt: "bound-key" }, validGrant],
  ] as const;

  it.each(rejected)("rejects %s on GET, POST, and DELETE", async (_name, token, grant) => {
    const app = protectedApp(token, grant);
    for (const method of ["get", "post", "delete"] as const) {
      const response = await request(app)[method]("/mcp").set("Authorization", "Bearer test-token");
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
    }
  });

  it("accepts only a valid token and its matching grant", async () => {
    const response = await request(protectedApp(validToken, validGrant)).get("/mcp").set("Authorization", "Bearer test-token");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ accountId: "account-a", clientId: "client-a" });
  });
});
