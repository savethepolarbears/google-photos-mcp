import logger from './logger.js';

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
 * Decodes a Base64URL encoded string.
 *
 * @param input - The Base64URL encoded string.
 * @returns The decoded string in UTF-8 format.
 */
function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), '=') : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Parses a Google ID token (JWT) to extract its payload.
 *
 * @param idToken - The JWT ID token string from Google.
 * @returns The parsed payload object, or null if parsing fails or token is missing.
 */
export function parseIdToken(idToken?: string | null): GoogleIdTokenPayload | null {
  if (!idToken) {
    return null;
  }

  try {
    const segments = idToken.split('.');
    if (segments.length < 2) {
      return null;
    }

    const payloadSegment = segments[1];
    const decoded = base64UrlDecode(payloadSegment);
    const payload = JSON.parse(decoded) as GoogleIdTokenPayload;
    return payload;
  } catch (error) {
    logger.warn(`Failed to parse Google ID token: ${error instanceof Error ? error.message : String(error)}`);
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
