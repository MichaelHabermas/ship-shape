import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobQueue } from '../src/console/job-queue.mjs';

test('tryStart rejects second job while first is running', async () => {
  const q = createJobQueue();
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const a = q.tryStart('run', {
    cleanupMs: 1000,
    run: async () => {
      await firstGate;
    },
  });
  assert.equal(a.conflict, false);

  const b = q.tryStart('run', {
    cleanupMs: 1000,
    run: async () => {},
  });
  assert.equal(b.conflict, true);
  assert.equal(b.jobId, a.jobId);

  releaseFirst();
  await new Promise((r) => setTimeout(r, 10));
});

test('jobs run sequentially on the chain', async () => {
  const q = createJobQueue();
  const order = [];

  q.tryStart('a', {
    cleanupMs: 1000,
    run: async () => {
      order.push('a');
    },
  });
  await new Promise((r) => setTimeout(r, 20));

  q.tryStart('b', {
    cleanupMs: 1000,
    run: async () => {
      order.push('b');
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['a', 'b']);
});
