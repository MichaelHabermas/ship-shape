import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHttpReachable, isHostedIntegrationUrl, isTunnelUrl, probeHttpUrl } from './plugforge-live-drill.mjs';

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

test('isHostedIntegrationUrl recognizes Render service origins', () => {
  assert.equal(isHostedIntegrationUrl('https://ship-shape-slack-integration.onrender.com/health'), true);
  assert.equal(isHostedIntegrationUrl('https://tunnel.example.test/health'), false);
  assert.equal(isHostedIntegrationUrl('http://127.0.0.1:8080'), false);
});

test('isTunnelUrl flags cloudflare and ngrok hosts', () => {
  assert.equal(isTunnelUrl('https://darwin-the-arabic-lows.trycloudflare.com/ship/webhooks'), true);
  assert.equal(isTunnelUrl('https://ship-shape-slack-integration.onrender.com/ship/webhooks'), false);
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
