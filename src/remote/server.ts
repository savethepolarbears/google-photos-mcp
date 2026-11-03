import express from "express";
import type { JWKS } from "oidc-provider";
import { getTokens } from "../auth/tokens.js";
import { AuthorizationStore } from "./authorization-store.js";
import { createAuthorizationProvider } from "./authorization-provider.js";
import { bearerAuth } from "./bearer-auth.js";
import { createInteractionRouter } from "./interactions.js";
import { createRemoteMcpTransport } from "./mcp-transport.js";
import { registrationGuard } from "./registration-guard.js";
import { requestGuards } from "./request-guards.js";

export interface RemoteServerOptions {
  origin: string;
  hosts: string[];
  origins: string[];
  trustedProxies: string[];
  jwks: JWKS;
  cookieKeys: string[];
  store: AuthorizationStore;
}

/** Build an HTTPS-behind-a-trusted-proxy server; the proxy must preserve Host. */
export function createRemoteServer(options: RemoteServerOptions) {
  const app = express();
  const provider = createAuthorizationProvider({ issuer: options.origin, jwks: options.jwks, cookieKeys: options.cookieKeys, store: options.store });
  const mcp = createRemoteMcpTransport(getTokens);
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustedProxies);
  app.use(requestGuards(options.hosts, options.origins));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use((req, res, next) => {
    if (!req.secure) return void res.status(400).send("HTTPS is required");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  const limits = new Map<string, { count: number; until: number }>();
  app.use((req, res, next) => {
    if (!/^\/(?:auth(?:\/|$)|token$|reg$|interaction\/)/.test(req.path)) return next();
    const now = Date.now();
    if (limits.size >= 10_000) {
      for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
    }
    const key = req.ip ?? "unknown";
    let entry = limits.get(key);
    if (!entry || entry.until <= now) {
      if (limits.size >= 10_000 && !entry) return void res.status(429).send("Rate limit exceeded");
      entry = { count: 0, until: now + 60_000 };
      limits.set(key, entry);
    }
    if (++entry.count > 120) return void res.status(429).send("Rate limit exceeded");
    next();
  });
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json({ resource: `${options.origin}/mcp`, authorization_servers: [options.origin], scopes_supported: ["photos"], bearer_methods_supported: ["header"] });
  });
  app.use(createInteractionRouter(provider, options.origin));
  app.post("/reg", express.json({ limit: "16kb" }), registrationGuard(options.store));
  app.use("/mcp", bearerAuth(provider, options.origin), express.json({ limit: "1mb" }), mcp.router);
  app.use(provider.callback());
  return { app, provider, close: () => mcp.close() };
}
