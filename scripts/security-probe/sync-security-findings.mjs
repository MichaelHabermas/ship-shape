#!/usr/bin/env node
/**
 * Merge bootstrap probe bindings into security-findings.json without removing manual edits.
 */
import { resolve } from 'node:path';
import { repoRoot } from './lib/cli.mjs';
import {
  DEFAULT_STORE_PATH,
  fingerprintForFinding,
  linkProbe,
  loadSecurityFindings,
  saveSecurityFindings,
} from './lib/security-findings-store.mjs';

const BOOTSTRAP = [
  {
    findingId: 'SS-FIND-001',
    probeId: 'authorization-governance-properties-injection',
    findingProbeId: 'probe-governance-properties-injection',
    role: 'regression',
    title: 'Member cannot PATCH plan_approval on sprint via documents API',
  },
  {
    findingId: 'SS-FIND-002',
    probeId: 'authorization-governance-accountable-self-assign',
    findingProbeId: 'probe-governance-accountable-self-assign',
    role: 'regression',
    title: 'Member cannot set accountable_id to self on program',
  },
  {
    findingId: 'SS-FIND-003',
    probeId: 'authorization-governance-week-status-bypass',
    findingProbeId: 'probe-governance-week-status-bypass',
    role: 'regression',
    title: 'Member cannot PATCH sprint/week status to completed',
  },
  {
    findingId: 'SS-FIND-004',
    probeId: 'authorization-weekly-plan-idor-documents',
    findingProbeId: 'probe-weekly-plan-idor-documents',
    role: 'regression',
    title: 'Member cannot read peer weekly plan via documents API',
  },
  {
    findingId: 'SS-FIND-005',
    probeId: 'authorization-weekly-plan-idor-websocket',
    findingProbeId: 'probe-weekly-plan-idor-websocket',
    role: 'regression',
    title: 'Member cannot open peer weekly plan collaboration room',
  },
  {
    findingId: 'SS-FIND-026',
    probeId: 'authorization-websocket-origin-reject',
    findingProbeId: 'probe-websocket-origin-reject',
    role: 'regression',
    title: 'Cross-origin WebSocket upgrade rejected',
  },
  {
    findingId: 'SS-FIND-025',
    probeId: 'authorization-file-upload-hijack-denied',
    findingProbeId: 'probe-file-upload-hijack-denied',
    role: 'regression',
    title: 'Member cannot complete another user pending upload',
  },
  {
    findingId: 'SS-FIND-012',
    probeId: 'abuse-public-feedback-rate-limit',
    findingProbeId: 'probe-public-feedback-rate-limit',
    role: 'regression',
    title: 'Public feedback endpoint rate limited',
  },
  {
    findingId: 'SS-FIND-012',
    probeId: 'abuse-login-rate-limit',
    findingProbeId: 'probe-login-rate-limit-absent',
    role: 'control',
    title: 'Login endpoint rate limits burst attempts',
  },
  {
    findingId: 'SS-FIND-029',
    probeId: 'auth-session-member-audit-logs-denied',
    findingProbeId: 'probe-member-audit-logs-denied',
    role: 'control',
    title: 'Member cannot access admin audit logs',
  },
  {
    findingId: 'SS-FIND-029',
    probeId: 'auth-session-member-impersonation-denied',
    findingProbeId: 'probe-member-impersonation-denied',
    role: 'control',
    title: 'Member cannot impersonate users',
  },
  {
    findingId: 'SS-FIND-007',
    probeId: 'authorization-bulk-issue-foreign-target',
    findingProbeId: 'probe-bulk-issue-foreign-target',
    role: 'control',
    title: 'Bulk issue update rejects inaccessible target IDs',
  },
  {
    findingId: 'SS-FIND-010',
    probeId: 'authorization-dashboard-private-metadata',
    findingProbeId: 'probe-dashboard-private-metadata',
    role: 'control',
    title: 'Dashboard my-focus does not leak private project metadata',
  },
  {
    findingId: 'SS-FIND-008',
    probeId: 'authorization-file-document-scope',
    findingProbeId: 'probe-file-document-scope',
    role: 'regression',
    title: 'File serve respects parent document visibility',
  },
  {
    findingId: 'SS-FIND-001',
    probeId: 'input-governance-mass-assignment',
    findingProbeId: 'probe-governance-mass-assignment',
    role: 'regression',
    title: 'Governance fields rejected on generic PATCH (input surface)',
  },
];

const store = loadSecurityFindings(DEFAULT_STORE_PATH);
let added = 0;

for (const seed of BOOTSTRAP) {
  const fingerprint = fingerprintForFinding(seed.probeId, seed.findingProbeId);
  const finding = store.findings.find((item) => item.id === seed.findingId);
  if (!finding) continue;
  const exists = finding.probes.some((probe) => probe.fingerprint === fingerprint);
  if (!exists) added++;
  linkProbe(store, seed.findingId, {
    probeId: seed.probeId,
    findingId: seed.findingProbeId,
    role: seed.role,
    title: seed.title,
  });
}

saveSecurityFindings(store);
console.log(`Synced probe bindings (${added} new) → ${resolve(repoRoot, DEFAULT_STORE_PATH)}`);
