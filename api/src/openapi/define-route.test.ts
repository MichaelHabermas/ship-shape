import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { generateOpenAPIDocument } from './registry.js';
import { defineRoute } from './define-route.js';

describe('defineRoute', () => {
  it('registers OpenAPI metadata for a typed route definition', () => {
    const PingSchema = z.object({ ok: z.literal(true) }).openapi('DefineRoutePing');

    defineRoute({
      method: 'get',
      path: '/define-route-test/ping',
      tags: ['Tests'],
      summary: 'defineRoute registration smoke test',
      responses: {
        200: { schema: PingSchema, description: 'Ping' },
      },
      handler: (_req, res) => {
        res.json({ ok: true });
      },
    });

    const spec = generateOpenAPIDocument();
    const operation = spec.paths?.['/define-route-test/ping']?.get;
    expect(operation?.responses?.['200']).toBeDefined();
  });

  it('returns the standard validation envelope by default', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', defineRoute({
      method: 'post',
      path: '/define-route-test/default-validation',
      tags: ['Tests'],
      summary: 'default validation test',
      request: {
        body: z.object({ title: z.string().min(1) }),
      },
      responses: {
        200: { schema: z.object({ ok: z.literal(true) }).openapi('DefaultValidationOk') },
      },
      handler: (_req, res) => {
        res.json({ ok: true });
      },
    }));

    const response = await request(app).post('/test').send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('can preserve a legacy validation envelope for migrated routes', async () => {
    const app = express();
    app.use(express.json());
    app.post('/test', defineRoute({
      method: 'post',
      path: '/define-route-test/legacy-validation',
      tags: ['Tests'],
      summary: 'legacy validation test',
      request: {
        body: z.object({ title: z.string().min(1) }),
      },
      responses: {
        200: { schema: z.object({ ok: z.literal(true) }).openapi('LegacyValidationOk') },
      },
      validationError: (res, error) => {
        res.status(400).json({ error: 'Invalid input', details: error.zodError.errors });
      },
      handler: (_req, res) => {
        res.json({ ok: true });
      },
    }));

    const response = await request(app).post('/test').send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid input');
    expect(response.body.details).toEqual(expect.any(Array));
  });

  it('documents the actual session cookie name', () => {
    const spec = generateOpenAPIDocument();
    expect(spec.components?.securitySchemes?.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'session_id',
    });
  });
});
