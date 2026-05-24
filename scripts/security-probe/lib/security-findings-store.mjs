import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repoRoot } from './cli.mjs';

export const DEFAULT_STORE_PATH = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/security-findings.json'
);
export const NARRATIVES_DIR = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/security-findings/narratives'
);
export const GENERATED_LEDGER_PATH = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/security-findings-ledger.md'
);

const WORKFLOW_STATUSES = new Set(['open', 'fixed', 'deferred', 'accepted_risk', 'in-progress']);
const PROBE_ROLES = new Set(['regression', 'control']);

export function fingerprintForFinding(probeId, findingId) {
  return `sha256:${createHash('sha256').update(`${probeId}:${findingId}`).digest('hex')}`;
}

export function loadSecurityFindings(storePath = DEFAULT_STORE_PATH) {
  if (!existsSync(storePath)) {
    return emptyStore();
  }
  const raw = JSON.parse(readFileSync(storePath, 'utf8'));
  return normalizeStore(raw);
}

export function saveSecurityFindings(store, storePath = DEFAULT_STORE_PATH) {
  const payload = {
    ...store,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function emptyStore() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    discovery: {
      date: null,
      method: null,
      sessionNote: null,
    },
    statusDefinitions: {
      open: 'Confirmed in code; not remediated',
      deferred: 'Acknowledged; fix intentionally postponed',
      'in-progress': 'Fix branch or PR underway',
      fixed: 'Remediated with linked evidence',
      accepted_risk: 'Accepted risk with documented rationale',
    },
    clusters: [],
    findings: [],
  };
}

function normalizeStore(raw) {
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    discovery: raw.discovery ?? { date: null, method: null, sessionNote: null },
    statusDefinitions: raw.statusDefinitions ?? emptyStore().statusDefinitions,
    clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
    findings: Array.isArray(raw.findings) ? raw.findings.map(normalizeFinding) : [],
  };
}

function normalizeFinding(finding) {
  return {
    ...finding,
    probes: Array.isArray(finding.probes) ? finding.probes : [],
    verifications: Array.isArray(finding.verifications) ? finding.verifications : [],
    clusterIds: Array.isArray(finding.clusterIds) ? finding.clusterIds : [],
    primaryLocations: Array.isArray(finding.primaryLocations)
      ? finding.primaryLocations
      : finding.primaryLocations
        ? [finding.primaryLocations]
        : [],
  };
}

export function getFindingById(store, id) {
  return store.findings.find((finding) => finding.id === id) ?? null;
}

export function getFindingByFingerprint(store, fingerprint) {
  for (const finding of store.findings) {
    const probe = finding.probes.find((binding) => binding.fingerprint === fingerprint);
    if (probe) return { finding, probe };
  }
  return null;
}

/** Flat registry rows for triage (backward-compatible shape). */
export function toFlatRegistryEntries(store) {
  const entries = [];
  for (const finding of store.findings) {
    for (const probe of finding.probes) {
      entries.push({
        fingerprint: probe.fingerprint,
        probeId: probe.probeId,
        findingId: probe.findingId,
        ledgerId: finding.id,
        status: probeRoleToRegistryStatus(probe.role, finding.status),
        title: probe.title || finding.title,
        findingStatus: finding.status,
      });
    }
  }
  return entries;
}

function probeRoleToRegistryStatus(role, findingStatus) {
  if (role === 'control') return 'control';
  if (findingStatus === 'fixed' || findingStatus === 'accepted_risk') return 'fixed';
  return 'open';
}

export function registryStatusToProbeRole(registryStatus) {
  if (registryStatus === 'control') return 'control';
  return 'regression';
}

export function lastVerification(finding) {
  if (!finding.verifications.length) return null;
  return finding.verifications[finding.verifications.length - 1];
}

export function appendVerification(finding, event) {
  finding.verifications.push({
    at: event.at || new Date().toISOString(),
    method: event.method,
    runId: event.runId ?? null,
    probeId: event.probeId ?? null,
    result: event.result,
    stillActive: event.stillActive ?? null,
    note: event.note ?? null,
  });
}

export function setFindingStatus(store, id, status, note) {
  if (!WORKFLOW_STATUSES.has(status)) {
    throw new Error(`Invalid status "${status}"`);
  }
  const finding = getFindingById(store, id);
  if (!finding) throw new Error(`Finding not found: ${id}`);
  finding.status = status;
  if (note) {
    appendVerification(finding, {
      method: 'manual',
      result: 'status_change',
      note: `status set to ${status}: ${note}`,
      stillActive: status === 'open' || status === 'in-progress',
    });
  }
  return finding;
}

export function linkProbe(store, findingId, binding) {
  const finding = getFindingById(store, findingId);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  const fingerprint =
    binding.fingerprint || fingerprintForFinding(binding.probeId, binding.findingId);
  if (!PROBE_ROLES.has(binding.role)) {
    throw new Error(`Invalid probe role "${binding.role}"`);
  }
  const existing = finding.probes.find((probe) => probe.fingerprint === fingerprint);
  const payload = {
    probeId: binding.probeId,
    findingId: binding.findingId,
    fingerprint,
    role: binding.role,
    title: binding.title || finding.title,
    expectedDenial: binding.expectedDenial || null,
  };
  if (existing) {
    Object.assign(existing, payload);
  } else {
    finding.probes.push(payload);
  }
  return payload;
}

export function appendProbeVerifications(
  store,
  { runId, probes, recordSkipped = false, storePath = DEFAULT_STORE_PATH }
) {
  const probeById = new Map(probes.map((probe) => [probe.id, probe]));
  for (const finding of store.findings) {
    for (const binding of finding.probes) {
      const probe = probeById.get(binding.probeId);
      if (!probe) continue;
      if (probe.status === 'skipped' && !recordSkipped) continue;
      if (probe.status === 'error') continue;

      const failed = (probe.findings || []).some(
        (item) =>
          fingerprintForFinding(item.probeId, item.id) === binding.fingerprint ||
          item.id === binding.findingId
      );
      const result =
        probe.status === 'skipped' ? 'skip' : probe.status === 'passed' && !failed ? 'pass' : 'fail';

      appendVerification(finding, {
        method: 'probe',
        runId,
        probeId: binding.probeId,
        result,
        stillActive: result === 'fail',
      });
    }
  }
  saveSecurityFindings(store, storePath);
}

/** @deprecated Use loadSecurityFindings — adapter for legacy import name */
export function loadFindingRegistry(storePath = DEFAULT_STORE_PATH) {
  const store = loadSecurityFindings(storePath);
  return { version: 1, entries: toFlatRegistryEntries(store) };
}
