import { isProduction } from '../config/runtime.js';
import type { Principal } from './principal.js';

const SETUP_TOKEN_HEADER = 'x-setup-token';

export function configuredSetupToken(): string | null {
  return process.env.SHIP_SETUP_TOKEN || process.env.SETUP_TOKEN || null;
}

export function setupTokenRequired(): boolean {
  return isProduction() || configuredSetupToken() !== null;
}

export function requestSetupToken(
  req: { headers: Record<string, unknown> },
  body?: { setup_token?: string }
): string | null {
  const header = req.headers[SETUP_TOKEN_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  return body?.setup_token?.trim() || null;
}

export function setupTokenAccepted(
  req: { headers: Record<string, unknown> },
  body?: { setup_token?: string }
): boolean {
  if (!setupTokenRequired()) return true;
  const expected = configuredSetupToken();
  if (!expected) return false;
  return requestSetupToken(req, body) === expected;
}

/** Principal for setup routes: `setup` when token accepted (or dev), else a session stub that fails setup authorize. */
export function setupPrincipalFromRequest(
  req: { headers: Record<string, unknown> },
  body?: { setup_token?: string }
): Principal {
  if (setupTokenAccepted(req, body)) {
    return { kind: 'setup' };
  }
  return {
    kind: 'session',
    sessionId: 'setup-unauthorized',
    userId: '00000000-0000-0000-0000-000000000000',
    workspaceId: '00000000-0000-0000-0000-000000000000',
    isSuperAdmin: false,
  };
}
