import { describe, it, expect } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { pool } from '../db/client.js';
import { SetupInitializeResponseSchema } from '../openapi/schemas/setup.js';
import { expectOpenApiResponse } from '../test/openapi-response.js';

function cookieHeader(response: request.Response): string {
  return response.headers['set-cookie']?.map((cookie: string) => cookie.split(';')[0]).join('; ') ?? '';
}

async function csrf(agent: request.SuperAgentTest) {
  const response = await agent.get('/api/csrf-token');
  return {
    token: response.body.token,
    cookie: cookieHeader(response),
  };
}

describe('Setup API', () => {
  const app = createApp();

  it('allows only one concurrent first-run initialization', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const csrfA = await csrf(agentA);
    const csrfB = await csrf(agentB);

    const [responseA, responseB] = await Promise.all([
      agentA
        .post('/api/setup/initialize')
        .set('Cookie', csrfA.cookie)
        .set('x-csrf-token', csrfA.token)
        .send({
          email: 'setup-race-a@ship.local',
          password: 'setup-password-a',
          name: 'Setup Race A',
        }),
      agentB
        .post('/api/setup/initialize')
        .set('Cookie', csrfB.cookie)
        .set('x-csrf-token', csrfB.token)
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
