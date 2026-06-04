// SDK webhook verifier tests pin Ship HMAC validity, tolerance, and malformed header behavior.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyWebhook } from './webhook.js';

const NOW_SECONDS = Date.UTC(2030, 0, 1, 0, 0, 0) / 1000;

describe('verifyWebhook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a valid v1 signature', () => {
    const rawBody = JSON.stringify({ id: 'evt_1', data: { ok: true } });
    const secret = 'ship_whsec_test';

    expect(verifyWebhook({ 'Ship-Signature': sign(rawBody, secret, NOW_SECONDS) }, rawBody, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const rawBody = JSON.stringify({ id: 'evt_1', data: { ok: true } });
    const secret = 'ship_whsec_test';

    expect(
      verifyWebhook({ 'Ship-Signature': sign(rawBody, secret, NOW_SECONDS) }, '{"id":"evt_1"}', secret)
    ).toBe(false);
  });

  it('rejects signatures outside the default tolerance', () => {
    const rawBody = '{}';
    const secret = 'ship_whsec_test';

    expect(verifyWebhook({ 'ship-signature': sign(rawBody, secret, NOW_SECONDS - 301) }, rawBody, secret)).toBe(false);
  });

  it('accepts signatures exactly at the default tolerance', () => {
    const rawBody = '{}';
    const secret = 'ship_whsec_test';

    expect(verifyWebhook({ 'ship-signature': sign(rawBody, secret, NOW_SECONDS - 300) }, rawBody, secret)).toBe(true);
  });

  it('rejects headers missing the v1 signature', () => {
    expect(verifyWebhook({ 'ship-signature': `t=${NOW_SECONDS}` }, '{}', 'ship_whsec_test')).toBe(false);
  });
});

function sign(rawBody: string, secret: string, timestampSeconds: number): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}
