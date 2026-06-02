// Public route metadata keeps method and scope contracts explicit for /api/v1.
import type { PublicApiScope } from '../../scopes/registry.js';

// Current edge-piece methods only. Extend this union when a real public route
// needs another method; do not treat GET/POST as the whole platform contract.
export type PublicHttpMethod = 'GET' | 'POST';

// Minimal route metadata anchor for OpenAPI/scope parity. Auth-only routes use
// requiredScope null rather than inventing scopes outside canon.
export type PublicRouteMetadata = {
  method: PublicHttpMethod;
  path: string;
  requiredScope: PublicApiScope | null;
};
