import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enrichFindingForDisplay,
  findingActiveLabel,
  findingActiveSortRank,
} from '../src/core/finding-display.mjs';

test('findingActiveLabel marks open findings without verification as yes', () => {
  const finding = { id: 'SS-FIND-001', status: 'open', verifications: [] };
  assert.equal(findingActiveLabel(finding), 'yes');
});

test('findingActiveLabel marks fixed findings as no', () => {
  const finding = { id: 'SS-FIND-002', status: 'fixed', verifications: [] };
  assert.equal(findingActiveLabel(finding), 'no');
});

test('findingActiveLabel uses last verification stillActive', () => {
  const finding = {
    id: 'SS-FIND-003',
    status: 'in-progress',
    verifications: [{ at: '2026-01-01', method: 'probe', result: 'pass', stillActive: false }],
  };
  assert.equal(findingActiveLabel(finding), 'no');
});

test('enrichFindingForDisplay adds activeLabel and sort rank', () => {
  const enriched = enrichFindingForDisplay({ id: 'SS-FIND-004', status: 'open', verifications: [] });
  assert.equal(enriched.activeLabel, 'yes');
  assert.equal(enriched.active, true);
  assert.equal(findingActiveSortRank(enriched), 2);
});
