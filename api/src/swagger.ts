/**
 * Swagger/OpenAPI Setup
 *
 * This module configures Swagger UI and serves the OpenAPI specification.
 * Schemas are auto-generated from Zod validators via @asteasolutions/zod-to-openapi.
 */

import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { OpenAPIObject } from 'openapi3-ts/oas30';

// Import the OpenAPI module to register all schemas
import { generateOpenAPIDocument } from './openapi/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate the OpenAPI spec from registered schemas
export const swaggerSpec: OpenAPIObject = generateOpenAPIDocument();

export function setupSwagger(app: Express): void {
  // Serve swagger UI at /api/docs
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Ship API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'method',
    },
  }));

  // Serve the raw OpenAPI spec
  app.get('/api/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  app.get('/api/openapi.yaml', (req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    const yaml = jsonToYaml(swaggerSpec);
    res.send(yaml);
  });
}

// Simple JSON to YAML converter (no external dependency needed)
function jsonToYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null) return 'null';
  if (obj === undefined) return '';
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const value = jsonToYaml(item, indent + 1).trim();
        const [firstLine, ...rest] = value.split('\n');
        return `${spaces}- ${firstLine}${rest.length ? `\n${rest.join('\n')}` : ''}`;
      }
      const value = jsonToYaml(item, indent + 1);
      return `${spaces}- ${value}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries.map(([key, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (Object.keys(value).length === 0) {
          return `${spaces}${key}: {}`;
        }
        return `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          return `${spaces}${key}: []`;
        }
        return `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
      } else {
        return `${spaces}${key}: ${jsonToYaml(value, indent)}`;
      }
    }).join('\n');
  }

  return String(obj);
}

// Generate static openapi.yaml file
export function generateOpenApiFile(): void {
  const yaml = jsonToYaml(swaggerSpec);
  const outputPath = path.join(__dirname, '..', 'openapi.yaml');
  fs.writeFileSync(outputPath, yaml, 'utf-8');
  console.log(`OpenAPI spec written to ${outputPath}`);

  // Also generate JSON version
  const jsonPath = path.join(__dirname, '..', 'openapi.json');
  fs.writeFileSync(jsonPath, JSON.stringify(swaggerSpec, null, 2), 'utf-8');
  console.log(`OpenAPI spec written to ${jsonPath}`);
}
