// Projection tests for submission ledger view-model boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLedgerModel, projectSecurityTab } from './ledger-projections.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(rootDir, 'my-docs/evidence/submission-ledger.json');

test('projectSecurityTab extracts cat-8 category', () => {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const projection = projectSecurityTab(ledger);
  assert.equal(projection.category?.id, 'cat-8-security-audit');
});

test('buildLedgerModel includes securityTab projection', () => {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const model = buildLedgerModel(ledger);
  assert.equal(model.securityTab.category?.id, 'cat-8-security-audit');
});
