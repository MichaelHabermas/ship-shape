#!/usr/bin/env node
/**
 * One-time migration: hand-edited ledger + probe-finding-registry → security-findings.json + narratives.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { repoRoot } from '../security-probe/lib/cli.mjs';
import {
  DEFAULT_STORE_PATH,
  GENERATED_LEDGER_PATH,
  NARRATIVES_DIR,
  fingerprintForFinding,
  registryStatusToProbeRole,
  saveSecurityFindings,
  appendVerification,
  linkProbe,
} from '../security-probe/lib/security-findings-store.mjs';
import { renderSecurityFindingsLedger } from '../security-probe/lib/security-findings-render.mjs';

const AUDIT_DIR = resolve(repoRoot, 'my-docs/evidence/security-audit');
const LEGACY_LEDGER = resolve(AUDIT_DIR, 'security-findings-ledger.md');
const REGISTRY_PATH = resolve(AUDIT_DIR, 'probe-finding-registry.json');

const FIXED_IDS = new Set([
  'SS-FIND-001',
  'SS-FIND-002',
  'SS-FIND-003',
  'SS-FIND-004',
  'SS-FIND-005',
  'SS-FIND-012',
  'SS-FIND-025',
  'SS-FIND-026',
]);

const SEED_RUNS = [
  'probe-v2-baseline-unfixed',
  'probe-v2-post-fixes',
  'security-probe-ci-20260523-190801',
];

function parseSummaryTable(markdown) {
  const summaryStart = markdown.indexOf('## Summary');
  const summaryEnd = markdown.indexOf('## Related finding clusters');
  const block = markdown.slice(summaryStart, summaryEnd);
  const rows = [];
  for (const line of block.split('\n')) {
    const match = line.match(
      /^\|\s*(SS-FIND-\d{3})\s*\|\s*([^|]+)\|\s*(\w[\w-]*)\s*\|\s*([^|]+)\|\s*([^|]+)\s*\|/
    );
    if (!match) continue;
    const [, id, severity, , title, location] = match;
    rows.push({
      id,
      severity: normalizeSeverity(severity.trim()),
      title: title.trim(),
      primaryLocations: [location.trim().replace(/`/g, '')],
    });
  }
  return rows;
}

function normalizeSeverity(raw) {
  const s = raw.toLowerCase().replace(/\*/g, '').trim();
  if (s.startsWith('critical')) return 'critical';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('medium') || s.startsWith('med')) return 'medium';
  if (s.startsWith('low')) return 'low';
  return 'medium';
}

function parseClusters(markdown) {
  const start = markdown.indexOf('## Related finding clusters');
  const end = markdown.indexOf('\n## Critical');
  const block = markdown.slice(start, end);
  const clusters = [];
  for (const line of block.split('\n')) {
    const match = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+)\|/);
    if (!match) continue;
    const label = match[1].trim();
    const ids = match[2]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^SS-FIND-\d{3}$/.test(part));
    if (!ids.length) continue;
    clusters.push({
      id: label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      label,
      findingIds: ids,
    });
  }
  return clusters;
}

function parseFindingSections(markdown) {
  const sections = new Map();
  const parts = markdown.split(/^### (SS-FIND-\d{3})[ —-]/m);
  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1] || '';
    const titleLine = body.split('\n')[0] || '';
    const title = titleLine.trim();
    const meta = parseMetadataTable(body);
    const narrative = extractNarrative(body);
    sections.set(id, { title, meta, narrative });
  }
  return sections;
}

function parseMetadataTable(body) {
  const meta = {};
  const tableMatch = body.match(/\| Field \| Value \|[\s\S]*?(?=\n\n|\n\*\*)/);
  if (!tableMatch) return meta;
  for (const line of tableMatch[0].split('\n')) {
    const m = line.match(/^\|\s*\*?\*?([^|*]+)\*?\*?\s*\|\s*([^|]+)\|/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim().replace(/\*\*/g, '');
    if (key.includes('severity')) meta.severity = normalizeSeverity(value);
    if (key.includes('status')) meta.status = value.toLowerCase();
    if (key === 'owasp') meta.owasp = value.split(',')[0].trim().slice(0, 3);
    if (key.includes('category')) meta.category = value.toLowerCase().replace(/\s+/g, '-');
  }
  return meta;
}

function extractNarrative(body) {
  const afterTable = body.replace(/^[^\n]*\n/, '');
  const tableEnd = afterTable.search(/\n\n(?!\|)/);
  const rest = tableEnd >= 0 ? afterTable.slice(tableEnd).trim() : afterTable.trim();
  return rest.replace(/^---\s*$/gm, '').trim();
}

function definitionForFinding(id, title) {
  const defs = {
    'SS-FIND-001':
      'Member cannot set governance approval fields via PATCH /api/documents/:id',
    'SS-FIND-002': 'Member cannot self-assign accountable_id to gain approval authority',
    'SS-FIND-003': 'Member cannot PATCH sprint/week status to completed without authorization',
    'SS-FIND-004': 'Member cannot read peer weekly plan via generic documents API',
    'SS-FIND-005': 'Member cannot open peer weekly plan collaboration WebSocket room',
    'SS-FIND-008':
      'File GET serves only when caller can read parent document (not uploader-only interim)',
    'SS-FIND-012': 'Public feedback endpoint enforces dedicated rate limiting',
    'SS-FIND-025': 'Member cannot complete another user pending upload',
    'SS-FIND-026': 'Cross-origin WebSocket upgrade is rejected',
  };
  return defs[id] || title;
}

function clusterIdsForFinding(id, clusters) {
  return clusters.filter((cluster) => cluster.findingIds.includes(id)).map((cluster) => cluster.id);
}

function mergeRegistry(store, registry) {
  for (const entry of registry.entries || []) {
    const findingId = entry.ledgerId;
    if (!findingId) {
      attachOrphanControl(entry, store);
      continue;
    }
    const finding = store.findings.find((item) => item.id === findingId);
    if (!finding) continue;
    linkProbe(store, findingId, {
      probeId: entry.probeId,
      findingId: entry.findingId,
      fingerprint: entry.fingerprint,
      role: registryStatusToProbeRole(entry.status),
      title: entry.title,
    });
  }
}

function attachOrphanControl(entry, store) {
  const map = {
    'auth-session-member-audit-logs-denied': 'SS-FIND-029',
    'auth-session-member-impersonation-denied': 'SS-FIND-029',
    'abuse-login-rate-limit': 'SS-FIND-012',
  };
  const target = map[entry.probeId];
  if (!target) return;
  linkProbe(store, target, {
    probeId: entry.probeId,
    findingId: entry.findingId,
    fingerprint: entry.fingerprint,
    role: 'control',
    title: entry.title,
  });
}

function applyStatusReconciliation(store) {
  for (const finding of store.findings) {
    if (FIXED_IDS.has(finding.id)) {
      finding.status = 'fixed';
    } else if (finding.id === 'SS-FIND-008') {
      finding.status = 'open';
      finding.definition =
        'File serve must respect parent document visibility (probe currently checks uploader-only; document scope still open)';
    } else {
      finding.status = 'open';
    }
  }
}

function seedVerificationsFromRuns(store) {
  for (const runId of SEED_RUNS) {
    const reportPath = resolve(AUDIT_DIR, 'runs', runId, 'report.json');
    if (!existsSync(reportPath)) continue;
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const probes = report.probes || [];
    const probeById = new Map(probes.map((probe) => [probe.id, probe]));
    const finishedAt = report.run?.finishedAt || report.generatedAt;

    for (const finding of store.findings) {
      for (const binding of finding.probes) {
        const probe = probeById.get(binding.probeId);
        if (!probe) continue;
        const failed = (probe.findings || report.findings || []).some(
          (item) =>
            item.id === binding.findingId ||
            fingerprintForFinding(item.probeId || binding.probeId, item.id) === binding.fingerprint
        );
        const result =
          probe.status === 'skipped'
            ? 'skip'
            : probe.status === 'passed' && !failed
              ? 'pass'
              : 'fail';
        appendVerification(finding, {
          at: finishedAt,
          method: 'probe',
          runId,
          probeId: binding.probeId,
          result,
          stillActive: result === 'fail',
        });
      }
    }
  }
}

function main() {
  if (!existsSync(LEGACY_LEDGER)) {
    console.error(`Legacy ledger not found: ${LEGACY_LEDGER}`);
    process.exit(1);
  }

  const markdown = readFileSync(LEGACY_LEDGER, 'utf8');
  const summary = parseSummaryTable(markdown);
  const clusters = parseClusters(markdown);
  const sections = parseFindingSections(markdown);

  mkdirSync(NARRATIVES_DIR, { recursive: true });

  const findings = summary.map((row) => {
    const section = sections.get(row.id) || {};
    const narrativePath = `security-findings/narratives/${row.id}.md`;
    const narrativeFile = resolve(AUDIT_DIR, narrativePath);
    const narrativeBody = section.narrative || `_No narrative extracted for ${row.id}._`;
    writeFileSync(narrativeFile, `${narrativeBody}\n`);

    return {
      id: row.id,
      title: section.title || row.title,
      severity: section.meta?.severity || row.severity,
      status: 'open',
      discoveredAt: '2026-05-22',
      owasp: section.meta?.owasp || null,
      category: section.meta?.category || null,
      clusterIds: clusterIdsForFinding(row.id, clusters),
      primaryLocations: row.primaryLocations,
      definition: definitionForFinding(row.id, row.title),
      narrativePath,
      probes: [],
      verifications: [],
    };
  });

  const store = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    discovery: {
      date: '2026-05-22',
      method: 'deep_review',
      sessionNote: 'Single deep authorization review; migrated from hand-edited ledger',
    },
    statusDefinitions: {
      open: 'Confirmed in code; not remediated',
      deferred: 'Acknowledged; fix intentionally postponed',
      'in-progress': 'Fix branch or PR underway',
      fixed: 'Remediated with linked evidence',
      accepted_risk: 'Accepted risk with documented rationale',
    },
    clusters: clusters.map(({ id, label, findingIds }) => ({ id, label, findingIds })),
    findings,
  };

  if (existsSync(REGISTRY_PATH)) {
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    mergeRegistry(store, registry);
  }

  applyStatusReconciliation(store);
  seedVerificationsFromRuns(store);
  const saved = saveSecurityFindings(store, DEFAULT_STORE_PATH);

  const legacyArchive = resolve(AUDIT_DIR, 'security-findings-ledger.legacy.md');
  if (!existsSync(legacyArchive)) {
    copyFileSync(LEGACY_LEDGER, legacyArchive);
  }

  writeFileSync(GENERATED_LEDGER_PATH, renderSecurityFindingsLedger(saved));

  console.log(`Migrated ${store.findings.length} findings → ${DEFAULT_STORE_PATH}`);
  console.log(`Narratives: ${NARRATIVES_DIR}`);
  console.log(`Generated ledger: ${GENERATED_LEDGER_PATH}`);
  console.log(`Legacy archive: ${legacyArchive}`);
  console.log('');
  console.log('Status reconciliation (apply via CLI if needed):');
  for (const finding of store.findings) {
    console.log(`  ${finding.id}: ${finding.status}`);
  }
  console.log('');
  console.log('Next: pnpm security:findings:check');
}

main();
