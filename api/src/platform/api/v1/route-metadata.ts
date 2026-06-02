import type { PublicApiScope } from '../../scopes/registry.js';

// Current edge-piece methods only. Extend this union when a real public route
// needs another method; do not treat GET/POST as the whole platform contract.
export type PublicHttpMethod = 'GET' | 'POST';

// Minimal route metadata anchor for OpenAPI/scope parity. Request and response
// schema wiring is deliberately absent until the first real route exists.
export type PublicRouteMetadata = {
  method: PublicHttpMethod;
  path: string;
  scope: PublicApiScope;
};
