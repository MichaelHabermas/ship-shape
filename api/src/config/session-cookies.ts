import type { CookieOptions } from 'express';
import { SESSION_TIMEOUT_MS } from '@ship/shared';
import { isProduction, isRenderProduction } from './runtime.js';

export { isRenderProduction };

export function sessionSameSitePolicy(
  defaultPolicy: 'strict' | 'lax' = 'strict',
): 'strict' | 'lax' | 'none' {
  return isRenderProduction() ? 'none' : defaultPolicy;
}

export function sessionCookieOptions(
  overrides: Partial<CookieOptions> = {},
  defaultSameSite: 'strict' | 'lax' = 'strict',
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: sessionSameSitePolicy(defaultSameSite),
    maxAge: SESSION_TIMEOUT_MS,
    path: '/',
    ...overrides,
  };
}

export function sessionClearCookieOptions(
  overrides: Partial<CookieOptions> = {},
  defaultSameSite: 'strict' | 'lax' = 'strict',
): CookieOptions {
  const { maxAge, ...options } = sessionCookieOptions(overrides, defaultSameSite);
  return options;
}
