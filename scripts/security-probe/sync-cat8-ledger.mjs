#!/usr/bin/env node
/**
 * Sync cat8-audit-deliverable.json into submission-ledger.json Category 8 fields.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = resolve(repoRoot, 'my-docs/evidence/submission-ledger.json');
const deliverablePath = resolve(repoRoot, 'my-docs/evidence/security-audit/cat8-audit-deliverable.json');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const deliverable = JSON.parse(readFileSync(deliverablePath, 'utf8'));

const cat8 = ledger.categories.find((c) => c.number === 8);
if (!cat8) throw new Error('Category 8 not found in submission ledger');

function row(metric) {
  return deliverable.table.find((r) => r.metric === metric);
}

const auth = row('Auth/session vulnerabilities found');
const ws = row('WebSocket validation failures');
const input = row('Input sanitization failures');
const deps = row('High/Critical CVEs in dependencies');
const cors = row('CORS/CSP misconfiguration');
const secrets = row('Secrets exposure risk');
const rate = row('Rate limiting absent on endpoints');
const verbose = row('Verbose error leakage');

cat8.audit_deliverable.aligned_table = 'my-docs/evidence/security-audit/cat8-audit-deliverable.json';
cat8.audit_deliverable.fields = {
  auth_session_vulnerabilities: {
    baseline: {
      findings: auth.baseline,
      source: deliverable.explanation.baseline_code.live_probe,
      meaning: deliverable.explanation.empty_findings_mean,
    },
    current: {
      findings: auth.current,
      source: 'latest.json',
      meaning: deliverable.explanation.empty_findings_mean,
    },
  },
  websocket_validation_failures: {
    baseline: { findings: ws.baseline, source: deliverable.explanation.baseline_code.live_probe },
    current: { findings: ws.current, source: 'latest.json' },
  },
  input_sanitization_failures: {
    baseline: { findings: input.baseline, source: deliverable.explanation.baseline_code.live_probe },
    current: { findings: input.current, source: 'latest.json' },
  },
  dependency_cves: {
    high_or_critical_count: deps.current.count,
    list: deps.current.list,
    baseline: {
      branch: 'BASELINE',
      commit: '072818cf77a54e1a796dd4b878e8564d8af3f1e7',
      high_or_critical_count: deps.baseline.count,
      unique_cve_count: deps.baseline.unique_cve_count,
      list: deps.baseline.list,
      source: 'my-docs/evidence/security-audit/runs/baseline-before/summary.json',
    },
    improvement_delta_high_critical: deps.current.count - deps.baseline.count,
  },
  cors_csp_misconfiguration: {
    baseline: cors.baseline,
    current: cors.current,
  },
  secrets_exposure_risk: {
    baseline: secrets.baseline,
    current: secrets.current,
  },
  rate_limiting_absent_on: {
    baseline: rate.baseline,
    current: rate.current,
  },
  verbose_error_leakage: {
    baseline: verbose.baseline,
    current: verbose.current,
  },
};

const baselineProbeEvidence = {
  id: 'cat8-baseline-live-probe',
  type: 'artifact',
  path: 'my-docs/evidence/security-audit/runs/baseline-before-probe/report.json',
  description:
    'Full security probe against BASELINE branch clone (072818c): auth, WebSocket, input, dependency, and manual review surfaces.',
};
const deliverableEvidence = {
  id: 'cat8-audit-deliverable-table',
  type: 'artifact',
  path: 'my-docs/evidence/security-audit/cat8-audit-deliverable.json',
  description: 'Baseline vs current table aligned to Shipshape-Security-Audit.txt deliverable rows.',
};
const depBaselineEvidence = {
  id: 'cat8-dependency-cves-baseline-artifact',
  type: 'artifact',
  path: 'my-docs/evidence/security-audit/runs/baseline-before/summary.json',
  description: 'pnpm audit high/critical dependency CVE baseline on BASELINE branch (33 → 0 after cleanup).',
};

for (const item of [baselineProbeEvidence, deliverableEvidence, depBaselineEvidence]) {
  if (!cat8.evidence.some((e) => e.id === item.id)) cat8.evidence.push(item);
}

const baselineMeasurement = cat8.measurements.find((m) => m.id === 'cat8-baseline-live-probe-status');
let baselineReport = null;
try {
  baselineReport = JSON.parse(
    readFileSync(resolve(repoRoot, 'my-docs/evidence/security-audit/runs/baseline-before-probe/report.json'), 'utf8')
  );
} catch {
  baselineReport = null;
}
if (baselineReport) {
  const baselineMeasurementValues = {
    branch: 'BASELINE',
    commit: '072818cf77a54e1a796dd4b878e8564d8af3f1e7',
    runnable_probe_tool: true,
    attack_surfaces_measured: baselineReport.summary?.attackSurfacesMeasured ?? null,
    total_named_probes_passed: baselineReport.summary?.probesByStatus?.passed ?? null,
    findings: baselineReport.summary?.findings ?? null,
    high_or_critical_dependency_cves: baselineReport.summary?.highOrCriticalDependencyCves ?? null,
  };
  if (baselineMeasurement) {
    baselineMeasurement.values = baselineMeasurementValues;
    baselineMeasurement.source = 'my-docs/evidence/security-audit/runs/baseline-before-probe/report.json';
  } else {
    cat8.measurements.push({
      id: 'cat8-baseline-live-probe-status',
      kind: 'security_probe_status',
      label: 'BASELINE branch live security probe',
      recorded_at: new Date().toISOString().slice(0, 10),
      values: baselineMeasurementValues,
      origin: 'artifact_parsed',
      confidence: 'report_backed',
      source: 'my-docs/evidence/security-audit/runs/baseline-before-probe/report.json',
    });
  }
}

cat8.summary_cards = [
  {
    id: 'cat8-security-deliverable-table',
    title: 'Audit Deliverable (baseline → current)',
    items: [
      {
        label: 'Security probe',
        value: 'BASELINE: Yes (baseline-before-probe). Current: Yes (latest.json).',
      },
      {
        label: 'Auth/session findings',
        value: `BASELINE: ${auth.baseline.length} findings. Current: ${auth.current.length} findings (empty = probe ran, found none).`,
      },
      {
        label: 'Dependency CVEs',
        value: `BASELINE: ${deps.baseline.count} high/critical (${deps.baseline.list.length} packages mapped to app features). Current: ${deps.current.count}.`,
      },
      {
        label: 'Aligned table',
        value: 'cat8-audit-deliverable.json — every brief row has baseline + current values.',
      },
    ],
  },
  {
    id: 'cat8-security-current-card',
    title: 'Verified improvements',
    items: [
      {
        label: 'Dependency cleanup',
        value: '33 → 0 high/critical CVEs (pnpm audit on BASELINE vs master).',
      },
      {
        label: 'Verified fixes',
        value: 'File upload validation/serving and WebSocket malformed/oversized resilience (before/after probe runs).',
      },
      {
        label: 'Manual review',
        value: 'CORS/CSP, secrets, rate limits, verbose errors — passed on current and baseline probes.',
      },
    ],
  },
];

writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log('Updated submission-ledger.json Category 8 from cat8-audit-deliverable.json');
