// Fetches a CSRF token and merges connect.sid into the session cookie for mutating API tests.
import request from 'supertest';
import type { Express } from 'express';
import { CsrfTokenResponseSchema } from '../openapi/schemas/auth.js';
import { expectOpenApiResponse } from './openapi-response.js';

export async function getCsrfTokenFromApp(
  app: Express,
  sessionCookie: string
): Promise<{ token: string; sessionCookie: string }> {
  const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', sessionCookie);

  const { token } = expectOpenApiResponse({
    method: 'get',
    path: '/csrf-token',
    status: 200,
    response: csrfRes,
    openApiSchemaName: 'CsrfTokenResponse',
    schema: CsrfTokenResponseSchema,
  });

  const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
  const mergedCookie = connectSidCookie
    ? `${sessionCookie}; ${connectSidCookie}`
    : sessionCookie;

  return { token, sessionCookie: mergedCookie };
}
