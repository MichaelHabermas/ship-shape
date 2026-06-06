// Unit tests for PlugForge reviewer evidence loading and model shaping.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadReviewerEvidence } from './reviewer-evidence.mjs';
import { renderReviewerPacketHtml } from './render-html.mjs';
import { buildReviewerModel, flowStatusClass, openExternalLinksInNewTab, usesEphemeralTunnel } from './reviewer-model.mjs';

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

test('Slack section uses delivery log proof, not private Slack permalinks', async () => {
  const evidence = await loadReviewerEvidence();
  const model = buildReviewerModel(evidence);
  const html = renderReviewerPacketHtml(model);
  assert.match(html, /Verify Slack proof \(3 steps\)/);
  assert.match(html, /Developer tab → Delivery log/);
  assert.doesNotMatch(html, /chazzwazza\.slack\.com/);
  assert.doesNotMatch(html, />permalink</);
});

test('openExternalLinksInNewTab adds target to external anchors only', async () => {
  const evidence = await loadReviewerEvidence();
  const model = buildReviewerModel(evidence);
  const html = openExternalLinksInNewTab(renderReviewerPacketHtml(model));

  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    const href = tag.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1];
    if (!href || href.startsWith('#')) continue;
    assert.match(tag, /\btarget="_blank"/, `missing target="_blank" on ${tag}`);
    assert.match(tag, /\brel="noopener noreferrer"/, `missing rel on ${tag}`);
  }
});
