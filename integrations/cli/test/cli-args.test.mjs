// CLI argv routing smoke tests without hitting the network.
import assert from 'node:assert/strict';
import test from 'node:test';

test('parseArgs splits flags and positionals', async () => {
  const { parseArgs } = await import('../src/parse-args.mjs');
  const parsed = parseArgs(['issues', 'list', '--limit', '5', '--json']);
  assert.deepEqual(parsed.positionals, ['issues', 'list']);
  assert.equal(parsed.flags.limit, '5');
  assert.equal(parsed.flags.json, true);
});
