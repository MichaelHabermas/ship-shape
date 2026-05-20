/**
 * OpenAPI Schema Index
 *
 * Import all schema modules to register them with the OpenAPI registry.
 * The order of imports matters for dependencies (common must be first).
 */

// Common schemas (must be first as others depend on these)
export * from './common.js';

// Domain schemas
export * from './documents.js';
export * from './issues.js';
export * from './projects.js';
export * from './programs.js';
export * from './weeks.js';
export * from './standups.js';
export * from './team.js';
export * from './workspaces.js';
export * from './search.js';
export * from './files.js';
export * from './activity.js';
export * from './auth.js';
export * from './bootstrap.js';
export * from './backlinks.js';
export * from './claude.js';
export * from './dashboard.js';
export * from './accountability.js';
export * from './weekly-plans.js';
export * from './comments.js';
export * from './ai.js';

// Re-export registry and generator for convenience
export { registry, generateOpenAPIDocument } from '../registry.js';
