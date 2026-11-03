import { randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Request } from "express";
import type Provider from "oidc-provider";
import type { TokenData } from "../auth/tokens.js";
import { exchangeGoogleCode, googleAuthorizationUrl, saveGoogleCredentials } from "./google-identity.js";

type Pending = { uid: string; nonce: string; expires: number; result?: { accountId: string; tokens: Partial<TokenData> } };
const random = () => randomBytes(32).toString("base64url");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
const equal = (a: unknown, b: unknown): boolean => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
const cookie = (req: Request, name: string): string | undefined =>
  req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

/** Browser interactions are deliberately separate from the authorization provider. */
export function createInteractionRouter(provider: Provider, origin: string) {
  const router = express.Router();
  const forms = new Map<string, { value: string; expires: number }>();
  const pending = new Map<string, Pending>();
  const prune = () => {
    const now = Date.now();
    for (const [key, value] of forms) if (value.expires < now) forms.delete(key);
    for (const [key, value] of pending) if (value.expires < now) pending.delete(key);
  };
  const fail = (res: express.Response) => res.status(400).send("The authorization request is invalid or expired. Please start again.");
  const sameOrigin = (req: Request) => {
    const value = req.get("origin") || req.get("referer");
    try { return !!value && new URL(value).origin === origin; } catch { return false; }
  };
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "strict-origin"); res.set("Content-Security-Policy", "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"); next(); });
  router.get("/interaction/:uid", async (req, res, next) => {
    try {
      prune();
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.uid !== req.params.uid || !["login", "consent"].includes(interaction.prompt.name) || forms.size >= 1000) return fail(res);
      const value = random();
      forms.set(interaction.uid, { value, expires: Date.now() + 10 * 60_000 });
      const action = interaction.prompt.name === "login" ? "login" : "consent";
      const client = await provider.Client.find(String(interaction.params.client_id));
      const clientName = escapeHtml(client?.clientName || "An application");
      const redirect = escapeHtml(String(interaction.params.redirect_uri || ""));
      const buttons = action === "login" ? '<button type="submit">Continue with Google</button>' : '<button name="decision" value="allow" type="submit">Allow access</button> <button name="decision" value="deny" type="submit">Deny</button>';
      res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Google Photos authorization</title></head><body><h1>Google Photos authorization</h1><p>${clientName} requests access to your Google Photos account.</p><p>Client redirect: ${redirect}</p><p>${action === "login" ? "Continue to Google to connect your account." : "Allow this application to access your connected Google Photos account?"}</p><form method="post" action="/interaction/${encodeURIComponent(interaction.uid)}/${action}"><input type="hidden" name="csrf" value="${value}">${buttons}</form></body></html>`);
    } catch (error) { next(error); }
  });
  router.post("/interaction/:uid/:action", express.urlencoded({ extended: false, limit: "4kb" }), async (req, res, next) => {
    try {
      prune();
      const interaction = await provider.interactionDetails(req, res);
      const form = forms.get(interaction.uid);
      if (interaction.uid !== req.params.uid || !sameOrigin(req) || !form || !equal(req.body.csrf, form.value) || req.params.action !== interaction.prompt.name) return fail(res);
      forms.delete(interaction.uid);
      if (req.params.action === "login") {
        if (pending.size >= 1000) return fail(res);
        const state = random(), nonce = random();
        pending.set(state, { uid: interaction.uid, nonce, expires: Date.now() + 10 * 60_000 });
        res.cookie("__Host-google-state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 10 * 60_000 });
        return res.redirect(303, googleAuthorizationUrl(state, nonce));
      }
      if (req.params.action !== "consent" || !interaction.session) return fail(res);
      if (req.body.decision !== "allow") {
        await provider.interactionFinished(req, res, { error: "access_denied", error_description: "The user denied the request" }, { mergeWithLastSubmission: false });
        return;
      }
      const grant = new provider.Grant({ accountId: interaction.session.accountId, clientId: String(interaction.params.client_id) });
      if (interaction.prompt.details.missingOIDCScope) grant.addOIDCScope((interaction.prompt.details.missingOIDCScope as string[]).join(" "));
      for (const [resource, scopes] of Object.entries(interaction.prompt.details.missingResourceScopes ?? {})) grant.addResourceScope(resource, (scopes as string[]).join(" "));
      await provider.interactionFinished(req, res, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
    } catch (error) { next(error); }
  });
  router.get("/auth/callback", async (req, res) => {
    prune();
    const state = req.query.state;
    if (typeof state !== "string" || !equal(state, cookie(req, "__Host-google-state"))) return fail(res);
    const item = pending.get(state);
    pending.delete(state);
    if (!item || item.result || typeof req.query.code !== "string") return fail(res);
    try {
      item.result = await exchangeGoogleCode(req.query.code, item.nonce);
      const ticket = random();
      pending.set(ticket, item);
      res.cookie("__Host-google-state", ticket, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 10 * 60_000 });
      return res.redirect(303, `/interaction/${encodeURIComponent(item.uid)}/complete`);
    } catch { return fail(res); }
  });
  router.get("/interaction/:uid/complete", async (req, res, next) => {
    try {
      prune();
      const ticket = cookie(req, "__Host-google-state");
      const item = ticket && pending.get(ticket);
      if (!ticket || !item || !item.result || item.uid !== req.params.uid) return fail(res);
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.uid !== item.uid || interaction.prompt.name !== "login") return fail(res);
      pending.delete(ticket);
      res.clearCookie("__Host-google-state", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
      await saveGoogleCredentials(item.result.accountId, item.result.tokens);
      await provider.interactionFinished(req, res, { login: { accountId: item.result.accountId } }, { mergeWithLastSubmission: false });
    } catch (error) { next(error); }
  });
  return router;
}
