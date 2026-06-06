// Unit tests for PlugForge reviewer evidence loading and model shaping.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadReviewerEvidence } from './reviewer-evidence.mjs';
import { buildReviewerModel, flowStatusClass, usesEphemeralTunnel } from './reviewer-model.mjs';

test('loadReviewerEvidence accepts committed live evidence files', async () => {
  const evidence = await loadReviewerEvidence();
  assert.equal(evidence.matrix.status, 'passed');
  assert.equal(evidence.slack.status, 'passed');
  assert.equal(evidence.gitlab.status, 'passed');
  assert.equal(evidence.browser.status, 'passed');
});

test('buildReviewerModel exposes GitLab proof issue and six flows', async () => {
  const evidence = await loadReviewerEvidence();
  const model = buildReviewerModel(evidence);
  assert.equal(model.flows.length, 6);
  assert.match(model.gitlab.proofIssueId, /^[0-9a-f-]{36}$/);
  assert.match(model.graderCurl, /\/api\/v1\/issues\//);
  assert.ok(model.ttfe.totalMs > 0);
});

test('flowStatusClass distinguishes measured from passed', () => {
  assert.equal(flowStatusClass('passed'), 'status-pass');
  assert.equal(flowStatusClass('passed_in_proof_pack'), 'status-pass');
  assert.equal(flowStatusClass('measured'), 'status-measured');
  assert.equal(flowStatusClass('pending'), 'status-muted');
});

test('usesEphemeralTunnel flags cloudflare webhook targets in live evidence', async () => {
  const evidence = await loadReviewerEvidence();
  const model = buildReviewerModel(evidence);
  assert.equal(usesEphemeralTunnel(model), true);
});
