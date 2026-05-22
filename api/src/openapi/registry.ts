/**
 * OpenAPI Registry - Central registration point for all Zod schemas
 *
 * Uses @asteasolutions/zod-to-openapi to auto-generate OpenAPI specs from Zod schemas.
 * All route schemas should be registered here for full API documentation.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { OpenAPIObject } from 'openapi3-ts/oas30';

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z);

// Create the global registry
export const registry = new OpenAPIRegistry();

// Re-export z for use in schema definitions
export { z };

// Security schemes
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'API token authentication. Get your token from Settings > API Tokens.',
});

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'session_id',
  description: 'Session cookie authentication. Automatically set after login.',
});

/**
 * Generate the complete OpenAPI document from registered schemas
 */
export function generateOpenAPIDocument(): OpenAPIObject {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Ship API',
      version: '1.0.0',
      description: `
Ship is a project and sprint management platform with real-time collaboration.

## Authentication

All endpoints (except /auth/login and /health) require authentication via:
- **Session Cookie**: Automatically set after login (15-minute timeout, 12-hour absolute)
- **Bearer Token**: API tokens from Settings > API Tokens

## Core Concepts

- **Documents**: Everything in Ship is a document (wikis, issues, projects, sprints, etc.)
- **Document Type**: Each document has a \`document_type\` that determines its properties
- **Belongs To**: Documents can be associated via \`belongs_to\` array (programs, projects, sprints, parent issues)

## WebSocket Collaboration

Real-time editing available at \`/collaboration/{docType}:{docId}\` using Yjs CRDT protocol.
      `.trim(),
      contact: {
        name: 'Ship Team',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'API base path',
      },
    ],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  });
}
