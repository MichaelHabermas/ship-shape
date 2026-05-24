import { fingerprintForFinding } from './security-findings-store.mjs';

function enrichFinding(finding, registryEntry) {
  const fingerprint = finding.fingerprint || fingerprintForFinding(finding.probeId, finding.id);
  return {
    ...finding,
    fingerprint,
    ledgerId: finding.ledgerId || registryEntry?.ledgerId || null,
    registryStatus: registryEntry?.status || null,
    findingStatus: registryEntry?.findingStatus || null,
  };
}

function entryByFingerprint(entries, fingerprint) {
  return entries.find((entry) => entry.fingerprint === fingerprint);
}

/**
 * Triage probe results against flat registry entries from security-findings.json.
 */
export function triageFindings({ registry, probes }) {
  const entries = registry.entries ?? [];
  const probeById = new Map(probes.map((probe) => [probe.id, probe]));
  const failedFindings = probes.flatMap((probe) =>
    (probe.findings || []).map((finding) =>
      enrichFinding(
        finding,
        entryByFingerprint(
          entries,
          finding.fingerprint || fingerprintForFinding(finding.probeId, finding.id)
        )
      )
    )
  );

  const knownOpen = [];
  const resolved = [];
  const newlyDetected = [];
  const regressions = [];

  for (const finding of failedFindings) {
    const entry = entryByFingerprint(entries, finding.fingerprint);
    if (!entry) {
      newlyDetected.push({ ...finding, triage: 'new' });
      continue;
    }
    if (entry.status === 'control' || entry.status === 'fixed') {
      regressions.push({ ...finding, triage: 'regression', registryEntry: entry });
      continue;
    }
    knownOpen.push({ ...finding, triage: 'knownOpen', registryEntry: entry });
  }

  for (const entry of entries) {
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

export function suggestFindingUpdates(triage) {
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
    note: 'Probe passed; confirm with: pnpm security:findings:set-status <id> fixed --note "..."',
  }));
  const regressions = triage.regression.map((finding) => ({
    action: 'reopen',
    fingerprint: finding.fingerprint ?? finding.registryEntry?.fingerprint,
    probeId: finding.probeId ?? finding.registryEntry?.probeId,
    ledgerId: finding.ledgerId ?? finding.registryEntry?.ledgerId,
  }));
  return [...additions, ...statusUpdates, ...regressions];
}

/** @deprecated */
export const suggestRegistryUpdates = suggestFindingUpdates;
