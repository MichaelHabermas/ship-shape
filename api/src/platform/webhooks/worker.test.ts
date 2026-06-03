// Webhook delivery worker tests prove interval ticks invoke due-delivery processing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWebhookDeliveryWorker } from './worker.js';

describe('startWebhookDeliveryWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes processDue on each interval tick', async () => {
    vi.useFakeTimers();
    const processDue = vi.fn(async () => 0);
    const stop = startWebhookDeliveryWorker({
      intervalMs: 100,
      setIntervalFn: setInterval,
      clearIntervalFn: clearInterval,
      processDue,
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(processDue.mock.calls.length).toBeGreaterThanOrEqual(2);

    stop();
    const callsAfterStop = processDue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300);
    expect(processDue.mock.calls.length).toBe(callsAfterStop);
  });

  it('logs errors without stopping subsequent ticks', async () => {
    vi.useFakeTimers();
    const logger = { error: vi.fn() };
    const processDue = vi
      .fn()
      .mockRejectedValueOnce(new Error('tick failed'))
      .mockResolvedValue(0);
    const stop = startWebhookDeliveryWorker({
      intervalMs: 100,
      setIntervalFn: setInterval,
      clearIntervalFn: clearInterval,
      logger,
      processDue,
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(logger.error).toHaveBeenCalled();
    expect(processDue.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });
});
