import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNarrativePath } from '../src/console/narrative-paths.mjs';

test('safeNarrativePath rejects traversal', () => {
  assert.equal(safeNarrativePath('../../../package.json'), null);
  assert.equal(safeNarrativePath('/etc/passwd'), null);
});

test('safeNarrativePath rejects missing file', () => {
  assert.equal(safeNarrativePath('security-findings/narratives/does-not-exist-xyz.md'), null);
});
