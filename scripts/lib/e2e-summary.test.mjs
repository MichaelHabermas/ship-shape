// Tests for Playwright summary.json parsing.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readSummary } from './e2e-summary.mjs';

test('readSummary parses numeric fields with defaults', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-summary-'));
  const filePath = path.join(dir, 'summary.json');
  writeFileSync(filePath, JSON.stringify({ total: 10, passed: 8, failed: 2, ts: 1_700_000_000_000 }));

  const summary = readSummary(filePath);
  assert.equal(summary.total, 10);
  assert.equal(summary.passed, 8);
  assert.equal(summary.failed, 2);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.pending, 0);
  assert.equal(summary.ts, 1_700_000_000_000);
});
