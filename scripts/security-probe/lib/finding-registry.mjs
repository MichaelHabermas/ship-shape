import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './cli.mjs';

const DEFAULT_REGISTRY_PATH = resolve(repoRoot, 'my-docs/evidence/security-audit/probe-finding-registry.json');

export function fingerprintForFinding(probeId, findingId) {
  return `sha256:${createHash('sha256').update(`${probeId}:${findingId}`).digest('hex')}`;
}

export function loadFindingRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  if (!existsSync(registryPath)) {
    return { version: 1, entries: [] };
  }
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

function entryByFingerprint(registry, fingerprint) {
  return registry.entries.find((entry) => entry.fingerprint === fingerprint);
}

function enrichFinding(finding, registryEntry) {
  const fingerprint = finding.fingerprint || fingerprintForFinding(finding.probeId, finding.id);
  return {
    ...finding,
    fingerprint,
    ledgerId: finding.ledgerId || registryEntry?.ledgerId || null,
    registryStatus: registryEntry?.status || null,
  };
}

/**
 * Triage probe findings against the static registry.
 * - knownOpen: registry open + probe failed
 * - resolved: registry open + probe passed (fix candidate)
 * - new: probe failed + fingerprint not in registry
 * - regression: registry fixed + probe failed
 */
export function triageFindings({ registry, probes }) {
  const probeById = new Map(probes.map((probe) => [probe.id, probe]));
  const failedFindings = probes.flatMap((probe) =>
    (probe.findings || []).map((finding) => enrichFinding(finding, entryByFingerprint(registry, finding.fingerprint || fingerprintForFinding(finding.probeId, finding.id))))
  );

  const knownOpen = [];
  const resolved = [];
  const newlyDetected = [];
  const regressions = [];

  for (const finding of failedFindings) {
    const entry = entryByFingerprint(registry, finding.fingerprint);
    if (!entry) {
      newlyDetected.push({ ...finding, triage: 'new' });
      continue;
    }
    if (entry.status === 'control') {
      regressions.push({ ...finding, triage: 'regression', registryEntry: entry });
      continue;
    }
    if (entry.status === 'fixed') {
      regressions.push({ ...finding, triage: 'regression', registryEntry: entry });
      continue;
    }
    knownOpen.push({ ...finding, triage: 'knownOpen', registryEntry: entry });
  }

  for (const entry of registry.entries) {
    const probe = probeById.get(entry.probeId);
    if (!probe || probe.status === 'skipped' || probe.status === 'error') continue;
    const stillFailed = (probe.findings || []).some(
      (finding) => fingerprintForFinding(finding.probeId, finding.id) === entry.fingerprint
    );
    if (entry.status === 'control') {
      if (stillFailed || probe.status === 'failed') {
        regressions.push({
          registryEntry: entry,
          probeId: entry.probeId,
          triage: 'regression',
          title: entry.title,
        });
      }
      continue;
    }
    if (entry.status !== 'open') continue;
    if (!stillFailed && probe.status === 'passed') {
      resolved.push({ registryEntry: entry, probeId: entry.probeId, triage: 'resolved' });
    }
  }

  return {
    knownOpen,
    resolved,
    new: newlyDetected,
    regression: regressions,
    counts: {
      knownOpen: knownOpen.length,
      resolved: resolved.length,
      new: newlyDetected.length,
      regression: regressions.length,
    },
  };
}

export function suggestRegistryUpdates(triage) {
  const additions = triage.new.map((finding) => ({
    action: 'add',
    fingerprint: finding.fingerprint,
    probeId: finding.probeId,
    findingId: finding.id,
    ledgerId: finding.ledgerId || null,
    status: 'open',
    title: finding.title,
  }));
  const statusUpdates = triage.resolved.map(({ registryEntry }) => ({
    action: 'mark_fixed_candidate',
    fingerprint: registryEntry.fingerprint,
    ledgerId: registryEntry.ledgerId,
    probeId: registryEntry.probeId,
    note: 'Probe passed; confirm in security-findings-ledger.md before marking fixed.',
  }));
  const regressions = triage.regression.map((finding) => ({
    action: 'reopen',
    fingerprint: finding.fingerprint,
    probeId: finding.probeId,
    ledgerId: finding.ledgerId,
  }));
  return [...additions, ...statusUpdates, ...regressions];
}
