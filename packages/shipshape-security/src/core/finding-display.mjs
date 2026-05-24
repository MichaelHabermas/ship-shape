import { lastVerification } from './security-findings-store.mjs';

/** @returns {'yes' | 'no' | '—'} */
export function findingActiveLabel(finding) {
  const last = lastVerification(finding);
  if (finding.status === 'fixed' || finding.status === 'accepted_risk') return 'no';
  if (last?.stillActive === false) return 'no';
  if (last?.stillActive === true) return 'yes';
  if (finding.status === 'open') return 'yes';
  return '—';
}

/** Higher sorts first (active backlog). */
export function findingActiveSortRank(finding) {
  const label = findingActiveLabel(finding);
  if (label === 'yes') return 2;
  if (label === '—') return 1;
  return 0;
}

export function enrichFindingForDisplay(finding) {
  const activeLabel = findingActiveLabel(finding);
  return {
    ...finding,
    active: activeLabel === 'yes',
    activeLabel,
    activeSortRank: findingActiveSortRank(finding),
    lastVerification: lastVerification(finding),
  };
}

export function enrichFindingsStore(store) {
  const findings = (store?.findings || []).map(enrichFindingForDisplay);
  return { ...store, findings };
}
