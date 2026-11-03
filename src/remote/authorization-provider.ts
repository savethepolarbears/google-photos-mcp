import Provider, { errors, type JWKS } from "oidc-provider";
import { AuthorizationStore } from "./authorization-store.js";

/** Configuration supplied by the server after validating its public origin. */
export interface AuthorizationProviderOptions {
  issuer: string;
  jwks: JWKS;
  cookieKeys: string[];
  store: AuthorizationStore;
}

/**
 * Create the MCP authorization server. Interaction routes, registration
 * request restrictions and HTTP protection must be installed by the caller.
 * Do not expose this provider on its own.
 */
export function createAuthorizationProvider(options: AuthorizationProviderOptions): Provider {
  const issuer = new URL(options.issuer);
  if (issuer.protocol !== "https:" || issuer.pathname !== "/" || issuer.search || issuer.hash || issuer.username || issuer.password) {
    throw new Error("OAuth issuer must be an HTTPS origin");
  }
  if (options.cookieKeys.length === 0 || options.cookieKeys.some((key) => Buffer.byteLength(key) < 32)) {
    throw new Error("OAuth cookie keys must each contain at least 32 bytes");
  }
  const origin = issuer.origin;
  const resource = `${origin}/mcp`;
  const provider = new Provider(origin, {
    adapter: options.store.adapter,
    jwks: options.jwks,
    cookies: { keys: options.cookieKeys, short: { secure: true }, long: { secure: true } },
    responseTypes: ["code"],
    scopes: ["openid", "offline_access", "photos"],
    clientAuthMethods: ["none", "client_secret_basic", "client_secret_post"],
    pkce: { required: () => true },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: false },
      revocation: { enabled: true },
      userinfo: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resource,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, indicator) => {
          if (indicator !== resource) throw new errors.InvalidTarget("Unknown resource");
          return { scope: "photos", audience: resource, accessTokenFormat: "opaque", accessTokenTTL: 3600 };
        },
      },
    },
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    rotateRefreshToken: true,
    ttl: { AccessToken: 3600, AuthorizationCode: 120, RefreshToken: 30 * 24 * 60 * 60 },
    findAccount: async (_ctx, sub) => ({ accountId: sub, claims: async () => ({ sub }) }),
  });
  // The provider derives endpoint URLs from the incoming request. Pin those
  // inputs to the configured issuer, never to caller-supplied proxy headers.
  // The outer HTTP server must separately validate the original Host/Origin.
  provider.proxy = true;
  provider.middleware.unshift(async (ctx, next) => {
    ctx.req.headers["x-forwarded-host"] = issuer.host;
    ctx.req.headers["x-forwarded-proto"] = "https";
    await next();
  });
  return provider;
}
