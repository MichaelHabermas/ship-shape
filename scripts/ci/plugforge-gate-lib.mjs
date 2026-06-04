// Shared PlugForge gate helpers — live proof vs contract vs dev shortcuts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultLedgerPath = path.join(rootDir, 'my-docs/project-weeks-sot/week-6/proof-ledger.yaml');
const defaultEvidenceDir = path.join(rootDir, 'my-docs/evidence/plugforge-integrations');

export function allowsDevShortcuts() {
  return process.env.PLUGFORGE_ALLOW_DEV_SHORTCUTS === '1';
}

export function parseLedger(text) {
  const entries = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const idMatch = rawLine.match(/^  - id:\s*(.+)$/);
    if (idMatch) {
      current = { id: parseScalar(idMatch[1]) };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const fieldMatch = rawLine.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (fieldMatch) current[fieldMatch[1]] = parseScalar(fieldMatch[2]);
  }
  return entries;
}

export function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readLedger(ledgerPath = defaultLedgerPath) {
  return parseLedger(readFileSync(ledgerPath, 'utf8'));
}

export function liveProofGaps(entries) {
  return entries.filter((entry) => (
    entry.proof_tier === 'live_required' &&
    ['missing', 'partial', 'manual_pending'].includes(entry.status ?? '')
  ));
}

export function formatLiveProofGaps(gaps) {
  if (gaps.length === 0) return '';
  const lines = [
    '',
    '══════════════════════════════════════════════════════════════════',
    '  LIVE PROOF GATES OPEN — default PlugForge gates must fail',
    '══════════════════════════════════════════════════════════════════',
    '',
    'These ledger atoms require user-visible / real-system proof:',
    '',
  ];
  for (const entry of gaps) {
    lines.push(`  • ${entry.id} [${entry.status}]`);
    lines.push(`    ${entry.requirement ?? '(no requirement text)'}`);
    if (entry.gap && entry.gap !== 'none') lines.push(`    gap: ${entry.gap}`);
    lines.push('');
  }
  lines.push('Contract checks (OpenAPI, import boundaries, unit tests) may still pass.');
  lines.push('Behavior gates fail until the gaps above are closed with live evidence.');
  lines.push('');
  return lines.join('\n');
}

export function failLiveIntegrationRequired(flow) {
  const message = [
    '',
    '══════════════════════════════════════════════════════════════════',
    `  LIVE INTEGRATION PROOF REQUIRED (flow: ${flow})`,
    '══════════════════════════════════════════════════════════════════',
    '',
    'pnpm plugforge:integrations does NOT run mock Slack/GitLab/browser matrix flows.',
    'Mock runs prove nothing about user-visible behavior and are not allowed to pass gates.',
    '',
    'To implement live proof, provide real credentials and write evidence under:',
    '  my-docs/evidence/plugforge-integrations/live/',
    '',
    'Required user-visible outcomes:',
    '  • Slack: real OAuth install + message in a real channel (Slack API ts + channel id)',
    '  • GitLab: real project webhook → Ship issue external link visible in API/UI',
    '  • Browser: deployed https://ship-shape-web.onrender.com/sdk-demo connect + document list',
    '  • CLI/TTFE: device code approved via /oauth/device UI + archived verified webhook JSON',
    '',
    'Dev-only mock code path (always fails gates):',
    '  pnpm plugforge:integrations:mock',
    '',
    'Contract-only integration check (allowed now):',
    '  pnpm plugforge:integrations -- --flow boundary',
    '',
  ].join('\n');
  console.error(message);
  return message;
}

export function failDevShortcut(metricName, reason) {
  const message = [
    '',
    '══════════════════════════════════════════════════════════════════',
    `  DEV SHORTCUT — NOT LIVE PROOF (${metricName})`,
    '══════════════════════════════════════════════════════════════════',
    '',
    reason,
    '',
    'This probe may still be useful for timing diagnostics, but it must NOT pass CI gates',
    'until live user-visible behavior is proven in the proof ledger.',
    '',
    'Timing-only local runs (still not live proof):',
    '  PLUGFORGE_ALLOW_DEV_SHORTCUTS=1 pnpm plugforge:metrics:ttfe -- --no-write',
    '',
  ].join('\n');
  console.error(message);
  return message;
}

const allowedPassedProofClasses = new Set(['live', 'contract']);

export function isAllowedPassedIntegrationEvidence(json) {
  if (json.status !== 'passed') return true;
  return allowedPassedProofClasses.has(json.proof_class);
}

export function findInvalidIntegrationEvidence(evidenceDir = defaultEvidenceDir) {
  const problems = [];
  if (!existsSync(evidenceDir)) return problems;

  const skipNames = new Set(['last-failure.json']);
  let entries;
  try {
    entries = readdirSync(evidenceDir, { withFileTypes: true });
  } catch {
    return problems;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || skipNames.has(entry.name)) continue;
    const filePath = path.join(evidenceDir, entry.name);
    try {
      const json = JSON.parse(readFileSync(filePath, 'utf8'));
      if (!isAllowedPassedIntegrationEvidence(json)) {
        problems.push(
          `${path.relative(rootDir, filePath)} has status "passed" with proof_class ` +
          `"${json.proof_class ?? '(missing)'}" — only live or contract evidence may claim pass`
        );
      }
    } catch (error) {
      problems.push(`${path.relative(rootDir, filePath)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
