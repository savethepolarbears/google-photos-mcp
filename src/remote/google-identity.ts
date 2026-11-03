import { timingSafeEqual } from "node:crypto";
import { createOAuthClient } from "../api/oauth.js";
import { getTokens, saveTokens, type TokenData } from "../auth/tokens.js";
import config from "../utils/config.js";
import { parseIdToken } from "../utils/googleUser.js";

/** Verify a Google response before associating credentials with an MCP account. */
export function verifiedAccountId(
  payload: { sub?: string; nonce?: string } | null,
  expectedNonce: string,
): string {
  const expected = Buffer.from(expectedNonce);
  const actual = Buffer.from(payload?.nonce ?? "");
  if (!payload?.sub || !expected.length || actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)) {
    throw new Error("Google identity verification failed");
  }
  return `google:${payload.sub}`;
}

export function googleAuthorizationUrl(state: string, nonce: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", ...config.google.scopes],
    state,
    nonce,
  });
}

/** The caller must validate and consume the browser-bound state before invoking this. */
export async function exchangeGoogleCode(code: string, nonce: string): Promise<{
  accountId: string;
  tokens: Partial<TokenData>;
}> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  const payload = await parseIdToken(tokens.id_token, client);
  const accountId = verifiedAccountId(payload, nonce);
  if (!tokens.access_token || !tokens.expiry_date) {
    throw new Error("Google did not return usable credentials");
  }
  return {
    accountId,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expiry_date,
      userId: accountId,
    },
  };
}

/** Save only after the original authorization interaction has been revalidated. */
export async function saveGoogleCredentials(accountId: string, tokens: Partial<TokenData>): Promise<void> {
  const previous = await getTokens(accountId);
  const refreshToken = tokens.refresh_token || previous?.refresh_token;
  if (!accountId.startsWith("google:") || tokens.userId !== accountId ||
      !tokens.access_token || !tokens.expiry_date || !refreshToken) {
    throw new Error("Google credentials are incomplete");
  }
  await saveTokens(accountId, {
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
    refresh_token: refreshToken,
    userId: accountId,
  });
}
