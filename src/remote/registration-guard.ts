import type { RequestHandler } from "express";
import { isIP } from "node:net";
import type { AuthorizationStore } from "./authorization-store.js";

// Remote metadata-fetch fields are intentionally excluded: registration is
// unauthenticated and cannot be allowed to trigger requests to internal hosts.
const allowedFields = new Set([
  "redirect_uris", "client_name", "client_uri", "logo_uri", "tos_uri", "policy_uri", "contacts",
  "scope", "grant_types", "response_types", "token_endpoint_auth_method", "software_id", "software_version",
]);

export function registrationGuard(store: AuthorizationStore): RequestHandler {
  // Global limit is deliberately independent of forwarded headers; a trusted
  // reverse proxy may add a more granular IP-based limit at the edge.
  const requests: number[] = [];
  return (req, res, next) => {
    const now = Date.now();
    while (requests.length && requests[0] <= now - 60_000) requests.shift();
    if (requests.length >= 30 || store.countClients() >= 1000) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).json({ error: "temporarily_unavailable" });
    }
    requests.push(now);
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return void res.status(400).json({ error: "invalid_client_metadata" });
    }
    const metadata = body as Record<string, unknown>;
    if (Object.keys(metadata).some((key) => !allowedFields.has(key)) ||
        !Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 10) {
      return void res.status(400).json({ error: "invalid_client_metadata" });
    }
    const valid = metadata.redirect_uris.every((redirect: unknown) => {
      if (typeof redirect !== "string" || redirect.length > 2048) return false;
      try {
        const uri = new URL(redirect);
        if (uri.username || uri.password || uri.hash) return false;
        if (uri.protocol === "https:") return true;
        const host = uri.hostname.replace(/^\[|\]$/g, "");
        return uri.protocol === "http:" && (host === "localhost" || (isIP(host) === 4 && host.startsWith("127.")) || host === "::1");
      } catch { return false; }
    });
    if (!valid) return void res.status(400).json({ error: "invalid_redirect_uri" });
    next();
  };
}
