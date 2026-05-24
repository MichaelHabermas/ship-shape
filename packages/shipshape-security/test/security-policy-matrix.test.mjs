import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_POLICY_MATRIX } from '../src/probes/security-policy-matrix.mjs';

test('security policy matrix maps remaining findings to proof rows', () => {
  const expectedFindings = ['SS-FIND-017', 'SS-FIND-019', 'SS-FIND-020', 'SS-FIND-023', 'SS-FIND-031', 'SS-FIND-034'];
  const ids = new Set(SECURITY_POLICY_MATRIX.map(row => row.findingId));
  for (const id of expectedFindings) {
    assert.equal(ids.has(id), true, `${id} missing from matrix`);
  }
  for (const row of SECURITY_POLICY_MATRIX) {
    assert.equal(typeof row.probeId, 'string');
    assert.equal(typeof row.expected, 'string');
    assert.notEqual(row.probeId.length, 0);
    assert.notEqual(row.expected.length, 0);
  }
});
