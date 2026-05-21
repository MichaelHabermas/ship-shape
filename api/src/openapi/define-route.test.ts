import { describe, it, expect } from 'vitest';
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
});
