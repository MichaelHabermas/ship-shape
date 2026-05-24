import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './cli.mjs';
import { lastVerification } from './security-findings-store.mjs';

const AUDIT_DIR = resolve(repoRoot, 'my-docs/evidence/security-audit');

export function renderSecurityFindingsLedger(store) {
  const lines = [];
  lines.push('# Security Findings Ledger');
  lines.push('');
  lines.push(
    '> **Generated** from `security-findings.json`. Do not edit by hand. Regenerate: `pnpm security:findings:render`'
  );
  lines.push('');

  if (store.discovery?.date) {
    lines.push('## Discovery');
    lines.push('');
    lines.push(`- **Date:** ${store.discovery.date}`);
    if (store.discovery.method) lines.push(`- **Method:** ${store.discovery.method}`);
    if (store.discovery.sessionNote) lines.push(`- **Session:** ${store.discovery.sessionNote}`);
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(
    '| ID | Title | Severity | Status | Discovered | Last verification | Active | Primary location |'
  );
  lines.push(
    '|----|-------|----------|--------|------------|-------------------|--------|------------------|'
  );

  const sorted = [...store.findings].sort((a, b) => a.id.localeCompare(b.id));
  for (const finding of sorted) {
    const last = lastVerification(finding);
    const active =
      finding.status === 'fixed' || finding.status === 'accepted_risk'
        ? 'no'
        : last?.stillActive === false
          ? 'no'
          : last?.stillActive === true
            ? 'yes'
            : finding.status === 'open'
              ? 'yes'
              : '—';
    const lastAt = last ? `${last.at.slice(0, 10)} (${last.method}/${last.result})` : '—';
    const location = finding.primaryLocations?.[0] || '—';
    lines.push(
      `| ${finding.id} | ${escapeCell(finding.title)} | ${finding.severity} | ${finding.status} | ${finding.discoveredAt || '—'} | ${lastAt} | ${active} | ${escapeCell(location)} |`
    );
  }
  lines.push('');

  if (store.clusters?.length) {
    lines.push('## Clusters');
    lines.push('');
    lines.push('| Cluster | Findings |');
    lines.push('|---------|----------|');
    for (const cluster of store.clusters) {
      lines.push(`| ${cluster.id} | ${(cluster.findingIds || []).join(', ')} |`);
    }
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');

  for (const finding of sorted) {
    lines.push(`### ${finding.id}: ${finding.title}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push(`| Severity | ${finding.severity} |`);
    lines.push(`| Status | ${finding.status} |`);
    lines.push(`| OWASP | ${finding.owasp || '—'} |`);
    lines.push(`| Category | ${finding.category || '—'} |`);
    lines.push(`| Discovered | ${finding.discoveredAt || '—'} |`);
    if (finding.definition) {
      lines.push(`| Definition | ${escapeCell(finding.definition)} |`);
    }
    if (finding.clusterIds?.length) {
      lines.push(`| Clusters | ${finding.clusterIds.join(', ')} |`);
    }
    if (finding.probes?.length) {
      lines.push(`| Probes | ${finding.probes.map((p) => p.probeId).join(', ')} |`);
    }
    const last = lastVerification(finding);
    if (last) {
      lines.push(
        `| Last verification | ${last.at} — ${last.method} ${last.result}${last.stillActive != null ? ` (stillActive: ${last.stillActive})` : ''} |`
      );
    }
    lines.push('');

    const narrativePath = finding.narrativePath
      ? resolve(AUDIT_DIR, finding.narrativePath)
      : null;
    if (narrativePath && existsSync(narrativePath)) {
      const narrative = readFileSync(narrativePath, 'utf8').trim();
      if (narrative) {
        lines.push(narrative);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Generated at ${store.updatedAt || new Date().toISOString()} from security-findings.json*`);
  lines.push('');

  return lines.join('\n');
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
