import logger from './logger.js';

export interface GoogleIdTokenPayload {
  email?: string;
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), '=') : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

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
