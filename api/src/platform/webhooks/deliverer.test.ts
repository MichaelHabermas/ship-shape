// Webhook deliverer tests pin outbound HTTP transport edge cases.
import { describe, expect, it } from 'vitest';
import {
  FetchWebhookDeliverer,
  WEBHOOK_RESPONSE_EXCERPT_MAX_BYTES,
} from './deliverer.js';

describe('FetchWebhookDeliverer', () => {
  it('bounds response body reads before returning an excerpt', async () => {
    const encoder = new TextEncoder();
    const totalChunks = 100;
    let pullCount = 0;
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount > totalChunks) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode('x'.repeat(100)));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl: typeof fetch = async () => new Response(stream, { status: 202 });
    const deliverer = new FetchWebhookDeliverer(fetchImpl);

    const result = await deliverer.deliver({
      targetUrl: 'https://hooks.example.test/large',
      headers: { 'Content-Type': 'application/json' },
      rawBody: '{}',
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({
      responseStatus: 202,
      error: null,
    });
    expect(result.responseExcerpt).toHaveLength(WEBHOOK_RESPONSE_EXCERPT_MAX_BYTES);
    expect(pullCount).toBeLessThan(totalChunks);
    expect(canceled).toBe(true);
  });
});
