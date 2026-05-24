#!/usr/bin/env node
/**
 * Merge bootstrap entries into probe-finding-registry.json without removing manual edits.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './lib/cli.mjs';
import { fingerprintForFinding, loadFindingRegistry } from './lib/finding-registry.mjs';

const registryPath = resolve(repoRoot, 'my-docs/evidence/security-audit/probe-finding-registry.json');

const BOOTSTRAP = [
  { probeId: 'authorization-governance-properties-injection', findingId: 'probe-governance-properties-injection', ledgerId: 'SS-FIND-001', title: 'Member cannot PATCH plan_approval on sprint via documents API' },
  { probeId: 'authorization-governance-accountable-self-assign', findingId: 'probe-governance-accountable-self-assign', ledgerId: 'SS-FIND-002', title: 'Member cannot set accountable_id to self on program' },
  { probeId: 'authorization-governance-week-status-bypass', findingId: 'probe-governance-week-status-bypass', ledgerId: 'SS-FIND-003', title: 'Member cannot PATCH sprint/week status to completed' },
  { probeId: 'authorization-weekly-plan-idor-documents', findingId: 'probe-weekly-plan-idor-documents', ledgerId: 'SS-FIND-004', title: 'Member cannot read peer weekly plan via documents API' },
  { probeId: 'authorization-weekly-plan-idor-websocket', findingId: 'probe-weekly-plan-idor-websocket', ledgerId: 'SS-FIND-005', title: 'Member cannot open peer weekly plan collaboration room' },
  { probeId: 'authorization-websocket-origin-reject', findingId: 'probe-websocket-origin-reject', ledgerId: 'SS-FIND-026', title: 'Cross-origin WebSocket upgrade rejected' },
  { probeId: 'authorization-file-upload-hijack-denied', findingId: 'probe-file-upload-hijack-denied', ledgerId: 'SS-FIND-025', title: 'Member cannot complete another user pending upload' },
  { probeId: 'abuse-public-feedback-rate-limit', findingId: 'probe-public-feedback-rate-limit', ledgerId: 'SS-FIND-012', status: 'open', title: 'Public feedback endpoint rate limited' },
  { probeId: 'abuse-login-rate-limit', findingId: 'probe-login-rate-limit-absent', ledgerId: null, status: 'control', title: 'Login endpoint rate limits burst attempts' },
  { probeId: 'auth-session-member-audit-logs-denied', findingId: 'probe-member-audit-logs-denied', ledgerId: null, status: 'control', title: 'Member cannot access admin audit logs' },
  { probeId: 'auth-session-member-impersonation-denied', findingId: 'probe-member-impersonation-denied', ledgerId: null, status: 'control', title: 'Member cannot impersonate users' },
  { probeId: 'authorization-bulk-issue-foreign-target', findingId: 'probe-bulk-issue-foreign-target', ledgerId: 'SS-FIND-007', title: 'Bulk issue update rejects inaccessible target IDs' },
  { probeId: 'authorization-dashboard-private-metadata', findingId: 'probe-dashboard-private-metadata', ledgerId: 'SS-FIND-010', title: 'Dashboard my-focus does not leak private project metadata' },
  { probeId: 'authorization-file-document-scope', findingId: 'probe-file-document-scope', ledgerId: 'SS-FIND-008', title: 'File serve respects parent document visibility' },
  { probeId: 'input-governance-mass-assignment', findingId: 'probe-governance-mass-assignment', ledgerId: 'SS-FIND-001', title: 'Governance fields rejected on generic PATCH (input surface)' },
  { probeId: 'abuse-login-rate-limit', findingId: 'probe-login-rate-limit-absent', ledgerId: null, title: 'Login endpoint rate limits burst attempts' },
];

const registry = loadFindingRegistry(registryPath);
const byFingerprint = new Map(registry.entries.map((entry) => [entry.fingerprint, entry]));

for (const seed of BOOTSTRAP) {
  const fingerprint = fingerprintForFinding(seed.probeId, seed.findingId);
  if (byFingerprint.has(fingerprint)) {
    const existing = byFingerprint.get(fingerprint);
    if (seed.status && existing.status !== seed.status) existing.status = seed.status;
    continue;
  }
  const entry = {
    fingerprint,
    probeId: seed.probeId,
    findingId: seed.findingId,
    ledgerId: seed.ledgerId,
    status: seed.status || 'open',
    title: seed.title,
  };
  registry.entries.push(entry);
  byFingerprint.set(fingerprint, entry);
}

registry.version = 1;
registry.updatedAt = new Date().toISOString();
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Registry entries: ${registry.entries.length} (${registryPath})`);
