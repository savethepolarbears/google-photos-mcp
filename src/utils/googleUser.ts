import logger from './logger.js';
import { OAuth2Client } from 'google-auth-library';
import config from './config.js';

/**
 * Interface representing the payload of a Google ID Token.
 */
export interface GoogleIdTokenPayload {
  /** User's email address */
  email?: string;
  /** Subject identifier (unique user ID) */
  sub?: string;
  /** User's full name */
  name?: string;
  /** User's given (first) name */
  given_name?: string;
  /** User's family (last) name */
  family_name?: string;
  /** URL to the user's profile picture */
  picture?: string;
}

/**
 * Parses and verifies a Google ID token (JWT) with signature validation.
 * Uses OAuth2Client.verifyIdToken() to ensure token authenticity.
 *
 * SECURITY: This function verifies the JWT signature to prevent token forgery.
 * Do NOT use manual Base64 decoding without verification.
 *
 * @param idToken - The JWT ID token string from Google.
 * @param oauth2Client - The OAuth2 client for signature verification.
 * @returns The verified payload object, or null if verification fails or token is missing.
 */
export async function parseIdToken(
  idToken: string | null | undefined,
  oauth2Client: OAuth2Client
): Promise<GoogleIdTokenPayload | null> {
  if (!idToken) {
    return null;
  }

  try {
    // Verify JWT signature and claims (CRITICAL security requirement)
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      logger.warn('JWT verification succeeded but payload is empty');
      return null;
    }

    // Verify issuer is Google
    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      logger.warn(`Invalid JWT issuer: ${payload.iss}`);
      return null;
    }

    return {
      email: payload.email,
      sub: payload.sub,
      name: payload.name,
      given_name: payload.given_name,
      family_name: payload.family_name,
      picture: payload.picture,
    };
  } catch (error) {
    logger.error(
      `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Resolves a user identity from a Google ID token payload.
 * Determines a unique user ID and email from the payload.
 * Falls back to a generated ID if payload is missing.
 *
 * @param payload - The decoded Google ID token payload.
 * @returns An object containing the userId and optional email.
 */
export function resolveUserIdentity(payload: GoogleIdTokenPayload | null): {
  userId: string;
  email?: string;
} {
  if (!payload) {
    return { userId: `user_${Date.now()}` };
  }

  if (payload.email) {
    return { userId: payload.email, email: payload.email };
  }

  if (payload.sub) {
    return { userId: payload.sub, email: payload.email };
  }

  return { userId: `user_${Date.now()}`, email: payload.email };
}
