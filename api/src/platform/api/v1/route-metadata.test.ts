// Public route registry tests keep /api/v1 contract metadata from drifting.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request, { type Test } from 'supertest';
import { PUBLIC_API_SCOPES, PublicApiErrorSchema } from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import {
  publicApiV1RouteRegistry,
  type PublicRouteMetadata,
  type PublicRouteSdkMetadata,
} from './route-metadata.js';

describe('public API v1 route registry', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE request_id LIKE $1', [
      `${testRunId}-%`,
    ]);
  });

  it('declares unique operation ids and explicit scope requirements', () => {
    const operationIds = publicApiV1RouteRegistry.map(route => route.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    const allowedScopes = new Set<string>(PUBLIC_API_SCOPES);
    for (const route of publicApiV1RouteRegistry) {
      expect(Object.hasOwn(route, 'requiredScopes')).toBe(true);
      expect(Array.isArray(route.requiredScopes)).toBe(true);
      for (const scope of route.requiredScopes) {
        expect(allowedScopes.has(scope)).toBe(true);
      }
      if (route.auth === 'oauth') {
        expect(route.sdk).toBeDefined();
      }
    }
  });

  it('keeps handler mount paths aligned with public paths', () => {
    for (const route of publicApiV1RouteRegistry) {
      expect(route.path).toBe(`/api/v1${route.handlerMountPath}`);
      expect(['oauth', 'none']).toContain(route.auth);
    }
  });

  it('requires cursor pagination metadata for registered list endpoints', () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.isListEndpoint) {
        expect(route.pagination).toBe('cursor');
      }
    }
  });

  it('keeps route SDK metadata backed by real SDK methods', () => {
    const sdkSource = sdkSources();
    const routes: readonly PublicRouteMetadata[] = publicApiV1RouteRegistry;
    for (const route of routes) {
      if (!hasSdkMetadata(route)) continue;
      const { sdk } = route;
      const className = sdk.client === 'root'
        ? 'ShipClient'
        : `${sdk.client[0]?.toUpperCase()}${sdk.client.slice(1)}Client`;
      const classStart = sdkSource.indexOf(`class ${className}`);
      expect(classStart, `${route.operationId} SDK client ${className}`).toBeGreaterThanOrEqual(0);
      const nextClassStart = sdkSource.indexOf('\nexport class ', classStart + 1);
      const classSource = sdkSource.slice(
        classStart,
        nextClassStart === -1 ? undefined : nextClassStart
      );
      expect(classSource, `${route.operationId} SDK method ${sdk.method}`).toMatch(
        new RegExp(`\\b${sdk.method}\\s*\\(`)
      );
    }
  });

  it('returns the public ApiError contract on registered OAuth auth failures', async () => {
    for (const route of publicApiV1RouteRegistry) {
      if (route.auth !== 'oauth') continue;
      const requestId = `${testRunId}-${route.operationId.replace(/\W/g, '-')}`;
      const response = await publicRouteRequest(route).set('x-request-id', requestId);
      const body = expectJsonBody(response, 401, PublicApiErrorSchema);

      expect(body.code).toBe('unauthorized');
      expect(body.request_id).toBe(requestId);
    }
  });

  function publicRouteRequest(route: PublicRouteMetadata): Test {
    switch (route.method) {
      case 'GET':
        return request(app).get(route.path);
      case 'POST':
        return request(app).post(route.path);
      case 'PATCH':
        return request(app).patch(route.path);
    }
  }

  function sdkSources(): string {
    const candidates = [
      resolve(process.cwd(), '../sdk/src/index.ts'),
      resolve(process.cwd(), 'sdk/src/index.ts'),
      resolve(process.cwd(), '../sdk/src/resources.ts'),
      resolve(process.cwd(), 'sdk/src/resources.ts'),
    ];
    const sources = candidates
      .filter(candidate => existsSync(candidate))
      .map(candidate => readFileSync(candidate, 'utf8'));
    if (sources.length === 0) throw new Error('SDK source not found');
    return sources.join('\n');
  }

  function hasSdkMetadata(
    route: PublicRouteMetadata
  ): route is PublicRouteMetadata & { sdk: PublicRouteSdkMetadata } {
    return route.sdk !== undefined;
  }
});
