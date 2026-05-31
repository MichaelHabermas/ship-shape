/** First-run setup API tests (token gate and concurrent initialization). */
import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { SetupInitializeResponseSchema } from '../openapi/schemas/setup.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';
import { getCsrfTokenFromApp } from '../test/session-csrf.js';
import type { Express } from 'express';

async function csrf(_agent: request.SuperAgentTest, app: Express) {
  const { token, sessionCookie } = await getCsrfTokenFromApp(app, '');
  return { token, cookie: sessionCookie };
}

describe('Setup API', () => {
  const app = createApp();

  it('requires the one-time setup token when configured', async () => {
    const previous = process.env.SHIP_SETUP_TOKEN;
    process.env.SHIP_SETUP_TOKEN = 'expected-setup-token';
    const agent = request.agent(app);
    const csrfToken = await csrf(agent, app);

    try {
      const response = await agent
        .post('/api/setup/initialize')
        .set('Cookie', csrfToken.cookie)
        .set('x-csrf-token', String(csrfToken.token))
        .send({
          email: 'setup-token-denied@ship.local',
          password: 'setup-password',
          name: 'Setup Token Denied',
        });

      expect(response.status).toBe(403);
      const counts = await pool.query('SELECT COUNT(*)::int AS users FROM users');
      expect(counts.rows[0]).toEqual({ users: 0 });
    } finally {
      if (previous === undefined) {
        delete process.env.SHIP_SETUP_TOKEN;
      } else {
        process.env.SHIP_SETUP_TOKEN = previous;
      }
    }
  });

  it('allows only one concurrent first-run initialization', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const csrfA = await csrf(agentA, app);
    const csrfB = await csrf(agentB, app);

    const [responseA, responseB] = await Promise.all([
      agentA
        .post('/api/setup/initialize')
        .set('Cookie', csrfA.cookie)
        .set('x-csrf-token', String(csrfA.token))
        .send({
          email: 'setup-race-a@ship.local',
          password: 'setup-password-a',
          name: 'Setup Race A',
        }),
      agentB
        .post('/api/setup/initialize')
        .set('Cookie', csrfB.cookie)
        .set('x-csrf-token', String(csrfB.token))
        .send({
          email: 'setup-race-b@ship.local',
          password: 'setup-password-b',
          name: 'Setup Race B',
        }),
    ]);

    const statuses = [responseA.status, responseB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 403]);

    const created = responseA.status === 201 ? responseA : responseB;
    const setup = expectOpenApiResponse({
      method: 'post',
      path: '/setup/initialize',
      status: 201,
      response: created,
      openApiSchemaName: 'SetupInitializeResponse',
      schema: SetupInitializeResponseSchema,
    });
    expect(setup.data.user.isSuperAdmin).toBe(true);

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM workspaces) AS workspaces,
        (SELECT COUNT(*)::int FROM workspace_memberships) AS memberships
    `);
    expect(counts.rows[0]).toEqual({ users: 1, workspaces: 1, memberships: 1 });
  });
});
