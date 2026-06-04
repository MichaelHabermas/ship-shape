#!/usr/bin/env node
// One-shot ledger patch: live-proof policy, demote mocked integration claims, non_scope submission exclusions.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(rootDir, 'my-docs/project-weeks-sot/week-6/proof-ledger.yaml');

const HEADER = `# PlugForge Week 6 atom proof ledger.
# Structural mode proves every atom is classified and traceable.
# Enforcement mode proves P0/P1 unit, api, e2e, and metric atoms are closed.
schema_version: 3
generated_from: my-docs/project-weeks-sot/week-6/PRD.md and my-docs/project-weeks-sot/week-6/w6-specs/Plugforge-specs.txt
status_values: proven, partial, missing, manual_pending, open_decision, non_scope, covered_by
proof_tier_values: live_required, unit_ok, not_applicable
#
# === LIVE PROOF POLICY (honesty reset 2026-06-04) ===
# Atoms with proof_tier live_required MUST NOT use status proven until a real external system
# or human-verifiable deployed surface participated. Disqualifiers include:
#   - injected mock fetch for Slack/GitLab/other SaaS APIs
#   - DB-seeded OAuth access tokens skipping real authorization
#   - synthetic webhook payloads not originating from the real provider
#   - script-self-written evidence JSON with status passed but no inspectable external artifact
#   - TTFE device-code approval via direct SQL instead of /oauth/device UI (for login live claims)
# proof_tier unit_ok: unit tests, static checks, and "script exists" metrics — never closes live_required atoms.
# proof_tier not_applicable: platform internals with no external SaaS (e.g. refresh-token rotation API test).
#
# Must be proven live before integration matrix (W6-INT-001) may return to proven:
live_proof_required_atoms:
  - W6-INT-001
  - W6-INT-002
  - W6-INT-003
  - W6-INT-004
  - W6-INT-005
  - W6-INT-006
  - W6-INT-008
  - W6-INT-009
  - W6-INT-010
  - W6-INT-011
  - W6-CLI-002
  - W6-CLI-003
  - W6-CLI-006
  - W6-CLI-007
  - W6-CLI-011
  - W6-CLI-012
  - W6-CLI-013
requirements:
`;

/** @type {Record<string, Partial<Record<string, string>>>} */
const PATCHES = {
  'W6-GLOBAL-001': {
    gap: 'Enforcement intentionally fails while live_required integration and TTFE login atoms remain partial or missing after mock-proof demotion.',
  },
  'W6-METRIC-001': { proof_tier: 'unit_ok' },
  'W6-METRIC-002': {
    status: 'partial',
    proof_tier: 'live_required',
    gap: 'TTFE timing gate uses approveDeviceCode SQL shortcut; clean-machine live login with UI approval not yet proven.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-METRIC-003': {
    status: 'partial',
    proof_tier: 'live_required',
    gap: 'Stage timings exist but login stage auto-approves device code via SQL, not live /oauth/device UI.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-METRIC-005': {
    status: 'partial',
    proof_tier: 'live_required',
    gap: 'P95 gate runs automated TTFE with DB device approval shortcut, not live login path.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-METRIC-006': {
    status: 'partial',
    proof_tier: 'live_required',
    gap: 'Flake loop runs automated TTFE with DB device approval shortcut, not live login path.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-001': {
    status: 'partial',
    proof_tier: 'unit_ok',
    proof_command: 'pnpm --filter @ship/cli check',
    proof_files: 'integrations/cli/src/index.mjs, integrations/cli/test',
    gap: 'Packed install works; live TTFE end-to-end with UI device approval not yet proven.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-002': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Live ship login with Device Grant UI approval on /oauth/device not recorded as evidence.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-003': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'pnpm drill ttfe auto-approves device code via SQL; live Device Grant flow not proven.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-004': { proof_tier: 'unit_ok' },
  'W6-CLI-005': { proof_tier: 'unit_ok' },
  'W6-CLI-006': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'pnpm --filter @ship/cli test',
    proof_files: 'integrations/cli/src/index.mjs, integrations/cli/test',
    gap: 'Unit tests pass; live docs create through authenticated CLI session not proven without device UI shortcut.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-007': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'pnpm --filter @ship/cli test',
    proof_files: 'integrations/cli/src/index.mjs, integrations/cli/test',
    gap: 'Automated TTFE verifies webhooks but uses DB device approval; live tail with human-inspectable verified JSON not archived.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-008': { proof_tier: 'unit_ok' },
  'W6-CLI-010': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    covered_by: 'none',
    gap: 'TTFE stages measured with device-code SQL shortcut; live UI approval path not proven.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-011': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Live TTFE with real OAuth login and ShipClient.webhooks.create not proven without SQL device shortcut.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-012': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Live TTFE document create via authenticated CLI session not proven without SQL device shortcut.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-013': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Verified document.created webhook JSON not archived from live CLI tail; automated drill output not retained.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-CLI-014': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    covered_by: 'none',
    gap: '60s runtime gate uses automated TTFE with DB device approval, not live login path.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-001': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Matrix runner mocked Slack API, seeded OAuth tokens, and synthesized GitLab webhooks; prior passed JSON invalidated.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-002': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    covered_by: 'none',
    gap: 'CLI login, create, subscription, receipt, and verification not proven live without device-code SQL shortcut.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-003': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Prior proof used DB-seeded Ship token and mocked Slack; no live signed webhook to real integration subscriber.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-004': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'chat.postMessage was mocked; no message in a real Slack channel.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-005': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'issue.assigned Slack post was mocked; no real Slack delivery.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-006': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'Slack OAuth callback was faked with code=oauth-code and mocked token exchange.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-007': { proof_tier: 'unit_ok' },
  'W6-INT-008': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'pnpm test:e2e:run e2e/plugforge-acceptance.spec.ts',
    proof_files: 'web/src/pages/SdkDemo.tsx, e2e/plugforge-acceptance.spec.ts',
    gap: 'Local Playwright PKCE passes; deployed https://ship-shape-web.onrender.com/sdk-demo not CI-gated as live proof.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-009': {
    status: 'partial',
    proof_tier: 'live_required',
    proof_command: 'pnpm test:e2e:run e2e/plugforge-acceptance.spec.ts',
    proof_files: 'web/src/pages/SdkDemo.tsx, e2e/plugforge-acceptance.spec.ts',
    gap: 'Document list proven in local E2E only; live deployed sdk-demo listing not gated.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-010': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'MR webhook payload was synthesized locally; no real GitLab instance involved.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-011': {
    status: 'missing',
    proof_tier: 'live_required',
    proof_command: 'none',
    proof_files: 'none',
    gap: 'No real GitLab project webhook to Ship integration path proven.',
    pending_test: 'api/src/platform/plugforge-acceptance.todo.test.ts',
  },
  'W6-INT-012': { proof_tier: 'not_applicable' },
  'W6-INT-013': { proof_tier: 'not_applicable' },
  'W6-SUBMIT-009': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Demo video explicitly excluded from final scope by project owner.',
  },
  'W6-SUBMIT-010': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Demo video OAuth segment excluded from final scope by project owner.',
  },
  'W6-SUBMIT-011': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Demo video webhook replay segment excluded from final scope by project owner.',
  },
  'W6-SUBMIT-012': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Demo video CLI/TTFE segment excluded from final scope by project owner.',
  },
  'W6-SUBMIT-013': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Pre-search attachment as submission artifact excluded; PRESEARCH.md remains in repo for reference.',
  },
  'W6-SUBMIT-014': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Saved AI conversation artifact excluded from final scope by project owner.',
  },
  'W6-SUBMIT-016': {
    status: 'non_scope',
    requirement_class: 'non_scope',
    proof_command: 'none',
    proof_files: 'none',
    pending_test: 'none',
    manual_evidence: 'none',
    covered_by: 'none',
    gap: 'Social post screenshot excluded from final scope by project owner.',
  },
};

function parseEntries(text) {
  const entries = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const idMatch = rawLine.match(/^  - id:\s*(.+)$/);
    if (idMatch) {
      current = { id: parseScalar(idMatch[1]), lines: [rawLine] };
      entries.push(current);
      continue;
    }
    if (current) current.lines.push(rawLine);
  }
  return entries;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function patchEntry(entry) {
  const patch = PATCHES[entry.id];
  if (!patch) return entry;

  const fieldOrder = [
    'id', 'source', 'section', 'requirement', 'requirement_class', 'testability', 'priority',
    'status', 'proof_tier', 'proof_command', 'proof_files', 'pending_test', 'manual_evidence', 'covered_by', 'gap',
  ];
  /** @type {Record<string, string>} */
  const fields = { id: entry.id };
  for (const line of entry.lines.slice(1)) {
    const match = line.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) fields[match[1]] = parseScalar(match[2]);
  }
  Object.assign(fields, patch);
  fields.id = entry.id;

  const rebuilt = [`  - id: ${fields.id}`];
  for (const key of fieldOrder) {
    if (key === 'id') continue;
    if (fields[key] === undefined) continue;
    rebuilt.push(`    ${key}: ${fields[key]}`);
  }
  return { id: entry.id, lines: rebuilt };
}

const original = readFileSync(ledgerPath, 'utf8');
const bodyStart = original.indexOf('requirements:');
if (bodyStart === -1) throw new Error('requirements: block not found');
const body = original.slice(bodyStart);
const entries = parseEntries(body).map(patchEntry);
const patchedBody = entries.map(entry => entry.lines.join('\n')).join('\n');
writeFileSync(ledgerPath, `${HEADER}${patchedBody}\n`);
console.log(`Patched ${Object.keys(PATCHES).length} atoms in ${path.relative(rootDir, ledgerPath)}`);
