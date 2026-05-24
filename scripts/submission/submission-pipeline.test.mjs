import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { ledgerPath, readJson, repoRoot } from './ledger-utils.mjs';
import { buildLedgerModel } from './ledger-projections.mjs';
import { replaceCurrentTruthSection, renderCurrentTruthBlock } from './render-markdown-sections.mjs';
import { renderDashboard, securityDeliverablePath, securityFindingsPath, securityReportPath } from './render-dashboard.mjs';
import { validateLedger } from './validate-ledger.mjs';

async function fixtureLedger() {
  return JSON.parse(await readFile(ledgerPath, 'utf8'));
}

test('validator catches stale computed percent metrics', async () => {
  const ledger = await fixtureLedger();
  const metric = ledger.categories[0].derived_metrics.find((item) => item.id === 'cat1-total-counted-syntax-reduction');
  metric.change_percent = -1;

  const errors = await validateLedger(ledger);

  assert(errors.some((error) => error.includes('derived_metrics[0].change_percent')));
});

test('validator catches target actual drift from referenced metric', async () => {
  const ledger = await fixtureLedger();
  const target = ledger.categories[0].targets.find((item) => item.id === 'cat1-target-total-counted-syntax-25-percent');
  target.actual = 1;

  const errors = await validateLedger(ledger);

  assert(errors.some((error) => error.includes('targets[0].actual') && error.includes('cat1-total-counted-syntax-reduction')));
});

test('validator rejects proven claims that depend on failing targets', async () => {
  const ledger = await fixtureLedger();
  const category = ledger.categories.find((item) => item.id === 'cat-3-api-response-time');
  const target = category.targets.find((item) => item.id === 'cat3-target-two-endpoints-p95');
  target.result = 'fail';
  const claim = category.claims[0];
  claim.status = 'proven';
  claim.basis = ['cat3-target-two-endpoints-p95'];

  const errors = await validateLedger(ledger);

  assert(errors.some((error) => error.includes('proven claim cannot depend on non-passing basis cat3-target-two-endpoints-p95')));
});

test('markdown generated block replacement is stable and scoped', async () => {
  const ledger = await fixtureLedger();
  const block = renderCurrentTruthBlock(buildLedgerModel(ledger));
  const markdown = [
    '### Current Ledger Truth',
    '',
    '- stale text',
    '',
    '### Operating Rule',
    '',
    'human text',
  ].join('\n');

  const next = replaceCurrentTruthSection(markdown, block);
  const rerendered = replaceCurrentTruthSection(next, block);

  assert.equal(next, rerendered);
  assert(next.includes('ledger:generated start id="submission-current-truth"'));
  assert(next.includes('### Operating Rule\n\nhuman text'));
});

test('dashboard render is deterministic from ledger projections', async () => {
  const ledger = await fixtureLedger();
  const discoveries = await readJson(resolve(repoRoot, 'my-docs/evidence/discoveries.json'));
  const securityReport = await readJson(securityReportPath);
  const securityFindings = await readJson(securityFindingsPath);
  const securityDeliverable = await readJson(securityDeliverablePath);
  const first = renderDashboard(ledger, discoveries, securityReport, securityFindings, securityDeliverable);
  const second = renderDashboard(ledger, discoveries, securityReport, securityFindings, securityDeliverable);

  assert.equal(first, second);
  assert(first.includes('GENERATED FILE'));
  assert(first.includes('data-ledger-id="cat-8-security-audit"'));
  assert(first.includes('id="ship-security-payload"'));
  assert(first.includes('Security Console'));
  assert(first.includes('Audit deliverable (brief table)'));
  assert(first.includes('security-finding-drawer'));
  assert(first.includes('id="security-run-ci"'));
  assert(first.includes('data-copy-command="pnpm security:probe:ci"'));
  assert(first.includes('id="security-auto-refresh"'));
  assert(first.includes('role="dialog"'));
});
