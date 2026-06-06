import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHttpReachable, probeHttpUrl } from './plugforge-live-drill.mjs';

test('probeHttpUrl captures status and response body for failed public health checks', async () => {
  const result = await probeHttpUrl('https://tunnel.example.test/health', {
    fetch: async () => new Response('503 - Tunnel Unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    body: '503 - Tunnel Unavailable',
  });
});

test('assertHttpReachable fails before running the live drill when health is unreachable', async () => {
  await assert.rejects(
    () => assertHttpReachable('https://tunnel.example.test/health', 'Public Slack webhook target health', {
      fetch: async () => new Response('503 - Tunnel Unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    }),
    /Public Slack webhook target health is not reachable.*503 - Tunnel Unavailable/s
  );
});
