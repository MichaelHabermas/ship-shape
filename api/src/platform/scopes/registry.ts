// Public scope guard keeps API authorization checks aligned with shared contracts.
import { PUBLIC_API_SCOPES, type PublicApiScope } from '@ship/shared';

const PUBLIC_SCOPE_SET = new Set<string>(PUBLIC_API_SCOPES);

export function isPublicApiScope(scope: string): scope is PublicApiScope {
  return PUBLIC_SCOPE_SET.has(scope);
}
