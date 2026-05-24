import test from 'node:test';
import assert from 'node:assert/strict';
import { attachJobStream, formatSseMessage } from '../src/console/job-stream.mjs';

test('formatSseMessage wraps JSON', () => {
  const line = formatSseMessage({ type: 'log', line: 'hello' });
  assert.match(line, /^data: /);
  assert.match(line, /\n\n$/);
});

test('attachJobStream replays logs and done', () => {
  const job = {
    logs: ['a', 'b'],
    listeners: new Set(),
    done: true,
    result: { ok: true, title: 'Test', exitCode: 0 },
  };
  const messages = [];
  const detach = attachJobStream(job, (msg) => messages.push(msg));
  assert.equal(messages.length, 3);
  assert.equal(messages[0].line, 'a');
  assert.equal(messages[2].type, 'done');
  detach();
  assert.equal(job.listeners.size, 0);
});
