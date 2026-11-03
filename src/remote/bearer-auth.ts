import type { RequestHandler } from "express";
import type Provider from "oidc-provider";

export interface McpPrincipal {
  accountId: string;
  clientId: string;
}

/** Protect every MCP method with the same issuer, audience and grant checks. */
export function bearerAuth(provider: Provider, publicOrigin: string): RequestHandler {
  const resource = `${publicOrigin}/mcp`;
  const challenge = `Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource/mcp"`;
  return async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(req.get("authorization") ?? "");
    const reject = () => {
      res.setHeader("WWW-Authenticate", challenge);
      res.status(401).json({ error: "invalid_token" });
    };
    if (!match) return void reject();
    try {
      const token = await provider.AccessToken.find(match[1]);
      if (!token || token.isExpired || token.aud !== resource || !token.accountId || !token.clientId || !token.grantId ||
          token.jkt || token["x5t#S256"] || !token.scope?.split(" ").includes("photos")) return void reject();
      const grant = await provider.Grant.find(token.grantId);
      if (!grant || grant.isExpired || grant.accountId !== token.accountId || grant.clientId !== token.clientId) return void reject();
      const principal: McpPrincipal = { accountId: token.accountId, clientId: token.clientId };
      res.locals.mcpPrincipal = principal;
      next();
    } catch {
      reject();
    }
  };
}
