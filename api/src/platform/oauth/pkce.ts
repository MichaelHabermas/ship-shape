// PKCE validation helpers for Authorization Code + S256 code exchange.
import crypto from 'crypto';

export function isValidPkceChallenge(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function isValidPkceVerifier(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(value);
}

export function pkceVerifierMatchesChallenge(verifier: string, expectedChallenge: string): boolean {
  const actualChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const actual = Buffer.from(actualChallenge);
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
