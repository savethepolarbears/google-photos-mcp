import type { RequestHandler } from "express";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

/** Canonicalize an HTTP authority without accepting credentials or paths. */
export function normalizeHostname(authority: string): string | null {
  if (!authority || /[\s,/@\\?#%]/.test(authority)) return null;
  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return isIP(hostname.slice(1, -1)) === 6 ? hostname : null;
    }
    const normalized = domainToASCII(hostname.replace(/\.$/, ""));
    if (!normalized || normalized.length > 253) return null;
    if (isIP(normalized) === 4) return normalized;
    if (!normalized.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) return null;
    return normalized;
  } catch {
    return null;
  }
}

/** Validate the actual request headers; forwarded host/origin are never trusted. */
export function requestGuards(allowedHosts: string[], allowedOrigins: string[]): RequestHandler {
  const hosts = new Set(allowedHosts.map((host) => {
    const result = normalizeHostname(host);
    if (!result) throw new Error("Invalid ALLOWED_HOSTS entry");
    return result;
  }));
  if (!hosts.size) throw new Error("ALLOWED_HOSTS must not be empty");
  const origins = new Set(allowedOrigins.map((value) => {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value) throw new Error("Invalid allowed origin");
    return parsed.origin;
  }));
  return (req, res, next) => {
    const host = normalizeHostname(req.headers.host ?? "");
    if (!host || !hosts.has(host)) return void res.status(403).send("Forbidden");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return void res.status(403).send("Forbidden");
    next();
  };
}
