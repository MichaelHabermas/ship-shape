import { enrichFindingsStore } from './enrich-findings.mjs';
import { securitySeverityRank, securitySurfaceLabel } from './utils.mjs';

export function buildSecurityView(ledgerOrProjection, securityReport = null, securityFindings = null, deliverable = null) {
  const category = ledgerOrProjection?.category
    ?? (ledgerOrProjection?.categories || []).find((item) => item.id === 'cat-8-security-audit')
    ?? null;
  const enrichedStore = enrichFindingsStore(securityFindings || { findings: [] });
  const findings = [...enrichedStore.findings].sort((a, b) => {
    const activeDelta = (b.activeSortRank ?? 0) - (a.activeSortRank ?? 0);
    if (activeDelta) return activeDelta;
    const severityDelta = securitySeverityRank(b.severity) - securitySeverityRank(a.severity);
    if (severityDelta) return severityDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const activeFindings = findings.filter((item) => item.activeLabel === 'yes');
  const probes = [...(securityReport?.probes || [])].sort((a, b) => {
    const surfaceDelta = securitySurfaceLabel(a.id).localeCompare(securitySurfaceLabel(b.id));
    if (surfaceDelta) return surfaceDelta;
    const statusDelta = String(a.status || '').localeCompare(String(b.status || ''));
    if (statusDelta) return statusDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const triageCounts = securityReport?.summary?.triageCounts || securityReport?.triage?.counts || {};
  const latestFindings = [...(securityReport?.findings || [])].sort(
    (a, b) => securitySeverityRank(b.severity) - securitySeverityRank(a.severity)
  );

  return {
    category,
    report: securityReport,
    deliverable,
    findingsStore: enrichedStore,
    findings,
    activeFindings,
    probes,
    latestFindings,
    triageCounts,
  };
}
