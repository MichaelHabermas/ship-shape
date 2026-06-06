import assert from 'node:assert/strict';
import test from 'node:test';
import {
  outOfScopeSubmissionAtoms,
  parseLedger,
  validateLedgerTargets,
  validateOutOfScopeSubmissionAtoms,
} from './plugforge-submission.mjs';

function entry(id, status, manualEvidence = 'https://example.com/evidence') {
  return {
    id,
    status,
    manual_evidence: manualEvidence,
  };
}

const baseIds = [
  'W6-AGENT-006',
  'W6-AGENT-007',
  'W6-AGENT-008',
  'W6-AGENT-009',
  'W6-AGENT-010',
  'W6-AGENT-011',
  'W6-DOC-001',
  'W6-DOC-002',
  'W6-DOC-003',
  'W6-DOC-004',
  'W6-DOC-005',
  'W6-DOC-006',
  'W6-DOC-007',
  'W6-DOC-008',
  'W6-DOC-009',
  'W6-DOC-010',
  'W6-DOC-011',
  'W6-SUBMIT-001',
  'W6-SUBMIT-002',
  'W6-SUBMIT-003',
  'W6-SUBMIT-004',
  'W6-SUBMIT-005',
  'W6-SUBMIT-007',
  'W6-SUBMIT-008',
  'W6-SUBMIT-015',
  'W6-DECISION-001',
  'W6-DECISION-002',
  'W6-DECISION-003',
  'W6-DECISION-004',
];

const externalIds = [
  'W6-SUBMIT-006',
];

test('parseLedger reads simple proof entries', () => {
  const entries = parseLedger([
    'requirements:',
    '  - id: W6-DOC-001',
    '    status: proven',
    '    manual_evidence: docs/architecture.md',
    '  - id: W6-SUBMIT-009',
    '    status: manual_pending',
    '    manual_evidence: final demo video link',
  ].join('\n'));

  assert.deepEqual(entries, [
    { id: 'W6-DOC-001', status: 'proven', manual_evidence: 'docs/architecture.md' },
    { id: 'W6-SUBMIT-009', status: 'manual_pending', manual_evidence: 'final demo video link' },
  ]);
});

test('out-of-scope atoms must stay non_scope and are not required proven', () => {
  const entries = outOfScopeSubmissionAtoms.map((id) => entry(id, 'non_scope', 'none'));
  assert.deepEqual(validateOutOfScopeSubmissionAtoms(entries), []);
  assert.deepEqual(
    validateLedgerTargets(
      [...entries, entry('W6-GLOBAL-001', 'partial', 'none')],
      { allowManualPending: false }
    ).filter((e) => e.includes('SUBMIT-009') || e.includes('SUBMIT-013') || e.includes('SUBMIT-016')),
    []
  );
});

test('regression: marking demo video proven fails out-of-scope guard', () => {
  const entries = outOfScopeSubmissionAtoms.map((id) =>
    entry(id, id === 'W6-SUBMIT-009' ? 'manual_pending' : 'non_scope', 'none')
  );
  const errors = validateOutOfScopeSubmissionAtoms(entries);
  assert(errors.some((e) => e.includes('W6-SUBMIT-009') && e.includes('non_scope')));
});

test('allow-manual-pending mode permits external attachment atoms to remain pending', () => {
  const entries = [
    ...baseIds.map((id) => entry(id, 'proven')),
    ...outOfScopeSubmissionAtoms.map((id) => entry(id, 'non_scope', 'none')),
    ...externalIds.map((id) => entry(id, 'manual_pending', 'final external attachment')),
    entry('W6-GLOBAL-001', 'proven'),
  ];

  assert.deepEqual(validateLedgerTargets(entries, { allowManualPending: true }), []);
});

test('strict mode requires external attachment atoms to be proven', () => {
  const entries = [
    ...baseIds.map((id) => entry(id, 'proven')),
    ...outOfScopeSubmissionAtoms.map((id) => entry(id, 'non_scope', 'none')),
    ...externalIds.map((id) => entry(id, 'manual_pending', 'final external attachment')),
    entry('W6-GLOBAL-001', 'partial', 'none'),
  ];

  const errors = validateLedgerTargets(entries, { allowManualPending: false });
  assert(errors.some((error) => error.includes('W6-SUBMIT-006 must be proven')));
});
