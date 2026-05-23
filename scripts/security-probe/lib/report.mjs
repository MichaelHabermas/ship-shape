import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repoRoot } from './cli.mjs';

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function buildReport({ config, probes, startedAt, finishedAt }) {
  const findings = probes.flatMap((probe) => probe.findings || []);
  const surfaces = {
    authSession: surfaceStatus(probes, 'auth-session'),
    websocketValidation: surfaceStatus(probes, 'websocket'),
    inputSanitization: surfaceStatus(probes, 'input'),
    dependencyCves: surfaceStatus(probes, 'dependency'),
  };
  const manualReview = {
    corsCsp: manualStatus(probes, 'manual-cors-csp'),
    secrets: manualStatus(probes, 'manual-secrets'),
    rateLimits: manualStatus(probes, 'manual-rate-limits'),
    verboseErrors: manualStatus(probes, 'manual-verbose-errors'),
  };

  return {
    schemaVersion: 1,
    generatedAt: finishedAt,
    run: {
      id: config.runId,
      startedAt,
      finishedAt,
      repo: repoRoot,
      target: config.target,
      mode: config.mode,
      apiUrl: config.apiUrl,
      webUrl: config.webUrl,
      wsUrl: config.wsUrl,
    },
    summary: {
      status: probes.some((probe) => probe.status === 'error') ? 'fail' : findings.length > 0 ? 'warn' : 'pass',
      attackSurfacesMeasured: Object.values(surfaces).filter((surface) => ['pass', 'partial', 'fail', 'error'].includes(surface.status)).length,
      findings: findings.length,
      findingsBySeverity: countBy(findings, (finding) => finding.severity),
      highOrCriticalDependencyCves: findings.filter((finding) => finding.category === 'dependency' && ['high', 'critical'].includes(finding.severity)).length,
      probesByStatus: countBy(probes, (probe) => probe.status),
    },
    surfaces,
    manualReview,
    findings,
    probes: probes.map(({ findings: _findings, ...probe }) => probe),
    createdArtifacts: probes.flatMap((probe) => probe.createdArtifacts || []),
    suggestedLedgerUpdate: {
      category: 'cat-8-security-audit',
      structuredReport: `my-docs/evidence/security-audit/runs/${config.runId}/report.json`,
      attackSurfacesMeasured: Object.values(surfaces).filter((surface) => ['pass', 'partial', 'fail', 'error'].includes(surface.status)).length,
      manualReviewComplete: Object.values(manualReview).every((review) => review.status !== 'not_measured'),
      note: 'Review before copying into submission-ledger.json; the probe does not auto-update claims.',
    },
  };
}

function surfaceStatus(probes, prefix) {
  const selected = probes.filter((probe) => probe.id.startsWith(prefix));
  if (selected.length === 0) return { status: 'not_measured', findings: [] };
  const measured = selected.filter((probe) => probe.status !== 'skipped');
  if (measured.length === 0) {
    return {
      status: 'skipped',
      findings: [],
      probes: selected.map((probe) => probe.id),
    };
  }
  return {
    status: measured.some((probe) => probe.status === 'failed') ? 'fail' : measured.some((probe) => probe.status === 'error') ? 'error' : selected.some((probe) => probe.status === 'skipped') ? 'partial' : 'pass',
    findings: measured.flatMap((probe) => probe.findingIds || []),
    probes: selected.map((probe) => probe.id),
  };
}

function manualStatus(probes, id) {
  const probe = probes.find((probe) => probe.id === id);
  if (!probe) return { status: 'not_measured' };
  return { status: probe.status === 'failed' ? 'needs_review' : probe.status, details: probe.details || {} };
}

export function renderMarkdown(report) {
  const lines = [
    `# Category 8 Security Probe ${report.run.id}`,
    '',
    `- API URL: ${report.run.apiUrl}`,
    `- Web URL: ${report.run.webUrl}`,
    `- Mode: ${report.run.mode}`,
    `- Attack surfaces measured: ${report.summary.attackSurfacesMeasured}/4`,
    `- Findings: ${report.summary.findings}`,
    '',
    '## Findings',
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('No security findings were confirmed by this run.', '');
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.severity.toUpperCase()}: ${finding.title}`);
      lines.push(`- ID: ${finding.id}`);
      lines.push(`- Probe: ${finding.probeId}`);
      lines.push(`- Expected: ${finding.expected}`);
      lines.push(`- Observed: ${finding.observed}`);
      if (finding.fixCandidate) lines.push(`- Fix candidate: ${finding.fixCandidate}`);
      if (finding.evidence?.reproduction?.length) {
        lines.push('- Reproduction:');
        for (const step of finding.evidence.reproduction) lines.push(`  - ${step}`);
      }
      lines.push('');
    }
  }
  lines.push('## Probe Results', '');
  for (const probe of report.probes) {
    lines.push(`- ${probe.id}: ${probe.status}${probe.skipReason ? ` (${probe.skipReason})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function writeReport(config, report) {
  const runDir = resolve(config.outDir, 'runs', config.runId);
  await mkdir(runDir, { recursive: true });
  const jsonPath = resolve(runDir, 'report.json');
  const mdPath = resolve(runDir, 'report.md');
  const latestJson = resolve(config.outDir, 'latest.json');
  const latestMd = resolve(config.outDir, 'latest.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(report));
  await copyFile(jsonPath, latestJson);
  await copyFile(mdPath, latestMd);
  await writeFile(resolve(config.outDir, 'suggested-ledger-update.json'), `${JSON.stringify(report.suggestedLedgerUpdate, null, 2)}\n`);
  return { jsonPath, mdPath, latestJson, latestMd };
}
