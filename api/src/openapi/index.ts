/**
 * OpenAPI Module Entry Point
 *
 * This module provides auto-generated OpenAPI documentation from Zod schemas.
 * All schemas are registered via the schema modules, which are imported here.
 */

// Import all schemas to trigger registration
import './schemas/index.js';

// Routes registered via defineRoute (side-effect registration at module load)
import '../routes/setup.js';

// Re-export the registry and generator
export { registry, generateOpenAPIDocument } from './registry.js';
export { defineRoute, RouteValidationError } from './define-route.js';
export type { DefinedRouteMetadata, DefineRouteConfig } from './define-route.js';
