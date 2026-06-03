// OAuth scope parsing and normalization for grant and token flows.
import type { PublicApiScope } from '@ship/shared';
import { isPublicApiScope } from '../scopes/registry.js';
import { OAuthProviderError } from './types.js';

export function parseOAuthScope(scope: string): PublicApiScope[] {
  const scopes = scope
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean);

  if (scopes.length === 0) {
    throw new OAuthProviderError('invalid_scope', 'At least one scope is required');
  }

  const uniqueScopes = [...new Set(scopes)];
  const publicScopes: PublicApiScope[] = [];
  for (const value of uniqueScopes) {
    if (!isPublicApiScope(value)) {
      throw new OAuthProviderError('invalid_scope', `Unknown scope: ${value}`);
    }
    publicScopes.push(value);
  }

  return publicScopes;
}

export function normalizeScopes(scopes: unknown): PublicApiScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(
    (scope): scope is PublicApiScope => typeof scope === 'string' && isPublicApiScope(scope)
  );
}

export function mergeScopes(currentScopes: PublicApiScope[], requestedScopes: PublicApiScope[]): PublicApiScope[] {
  return [...new Set([...currentScopes, ...requestedScopes])];
}

export function normalizeDeviceUserCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
