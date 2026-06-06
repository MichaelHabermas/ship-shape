#!/usr/bin/env node
// PlugForge final submission — one gate, runs everything, fails loudly.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseLedger } from './plugforge-gate-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerPath = path.join(rootDir, 'my-docs/project-weeks-sot/week-6/proof-ledger.yaml');
const args = new Set(process.argv.slice(2));
const allowManualPending = args.has('--allow-manual-pending');
const skipProofPack = args.has('--skip-proof-pack');
const skipOauthE2e = args.has('--skip-oauth-e2e');
const skipRender = args.has('--skip-render') || process.env.PLUGFORGE_SUBMISSION_SKIP_RENDER === '1';
const skipUrlCheck = args.has('--skip-url-check') || process.env.PLUGFORGE_SUBMISSION_SKIP_URLS === '1';
const skipLegacySubmission = args.has('--skip-legacy-submission') || process.env.PLUGFORGE_SUBMISSION_SKIP_LEGACY === '1';
const strictLegacySubmission = args.has('--strict-legacy-submission') || process.env.PLUGFORGE_SUBMISSION_STRICT_LEGACY === '1';

const baseClosedAtoms = [
  'W6-AGENT-006',
  'W6-AGENT-007',
  'W6-AGENT-008',
  'W6-AGENT-009',
  'W6-AGENT-010',
  'W6-AGENT-011',
  'W6-DOC-001',
  'W6-DOC-002',
  'W6-DOC-003',
  'W6-DOC-004',
  'W6-DOC-005',
  'W6-DOC-006',
  'W6-DOC-007',
  'W6-DOC-008',
  'W6-DOC-009',
  'W6-DOC-010',
  'W6-DOC-011',
  'W6-SUBMIT-001',
  'W6-SUBMIT-002',
  'W6-SUBMIT-003',
  'W6-SUBMIT-004',
  'W6-SUBMIT-005',
  'W6-SUBMIT-007',
  'W6-SUBMIT-008',
  'W6-SUBMIT-015',
  'W6-DECISION-001',
  'W6-DECISION-002',
  'W6-DECISION-003',
  'W6-DECISION-004',
];

const externalAttachmentAtoms = [
  'W6-SUBMIT-006',
];

/** Owner excluded Gauntlet attachments — atoms stay in ledger as non_scope; never block submission. */
const outOfScopeSubmissionAtoms = [
  'W6-SUBMIT-009',
  'W6-SUBMIT-010',
  'W6-SUBMIT-011',
  'W6-SUBMIT-012',
  'W6-SUBMIT-013',
  'W6-SUBMIT-016',
];

const requiredFiles = [
  'README.md',
  'REVIEWER_GUIDE.md',
  'docs/architecture.md',
  'docs/openapi.json',
  'my-docs/AI_COST_ANALYSIS.md',
  'my-docs/project-weeks-sot/week-6/FINAL_SUBMISSION_CHECKLIST.md',
  'my-docs/project-weeks-sot/week-6/EPIC_PROOF_WRITEUPS.md',
  'my-docs/project-weeks-sot/week-6/DISCOVERIES.md',
  'my-docs/project-weeks-sot/week-6/PRESEARCH.md',
  'my-docs/project-weeks-sot/week-6/DECISION_LOG-w6.md',
  'my-docs/project-weeks-sot/week-6/proof-ledger.yaml',
  'my-docs/project-weeks-sot/week-6/plugforge-reviewer-packet.html',
  'web/public/plugforge-reviewer-packet.html',
  'my-docs/evidence/plugforge-metrics/summary.json',
  'my-docs/evidence/plugforge-metrics/ttfe-timing.json',
];

const requiredUrls = [
  { label: 'web app', url: 'https://ship-shape-web.onrender.com/' },
  { label: 'reviewer packet', url: 'https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html' },
  { label: 'browser SDK demo', url: 'https://ship-shape-web.onrender.com/sdk-demo' },
  { label: 'developer portal route', url: 'https://ship-shape-web.onrender.com/settings?tab=developer' },
  { label: 'API health', url: 'https://ship-shape-api.onrender.com/health', kind: 'health' },
  { label: 'live public OpenAPI', url: 'https://ship-shape-api.onrender.com/api/v1/openapi.json', kind: 'openapi' },
];

async function main() {
  printBanner();

  const warnings = [];
  if (!skipLegacySubmission) {
    const legacyErrors = runLegacySubmissionChecks({ render: !skipRender });
    if (strictLegacySubmission) warnings.push(...legacyErrors.map((error) => `legacy submission strict mode: ${error}`));
    else if (legacyErrors.length > 0) {
      warnings.push('legacy Week 4 submission scripts reported archived evidence drift; Week 6 gate continues. Use --strict-legacy-submission to fail on this.');
    }
  }

  if (!skipProofPack) {
    runStep('Proof pack (lint, metrics, API tests, SDK, integration boundary, docs)', 'pnpm', ['plugforge:final']);
  }

  if (!skipOauthE2e) {
    runStep('OAuth Authorization Code + PKCE (Playwright)', 'bash', ['./scripts/ci/plugforge-oauth-e2e.sh']);
  }

  runStep('Gate honesty (live proof gaps and mock evidence)', 'pnpm', ['plugforge:gate-honesty']);

  const errors = strictLegacySubmission ? warnings.splice(0) : [];
  errors.push(...validateRequiredFiles(requiredFiles));

  const entries = parseLedger(readFileSync(ledgerPath, 'utf8'));
  errors.push(...validateOutOfScopeSubmissionAtoms(entries));
  errors.push(...validateLedgerTargets(entries, { allowManualPending }));
  errors.push(...validateEvidenceJson());

  if (!skipUrlCheck) errors.push(...await validateUrls(requiredUrls));

  if (errors.length > 0) {
    console.error('');
    console.error('══════════════════════════════════════════════════════════════════');
    console.error('  SUBMISSION GATE FAILED — evidence and ledger checks');
    console.error('══════════════════════════════════════════════════════════════════');
    console.error('');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  runStep('Proof ledger enforce (P0/P1 atoms must be proven)', 'pnpm', ['plugforge:ledger:enforce']);

  for (const warning of warnings) console.warn(`Warning: ${warning}`);

  const mode = allowManualPending ? 'pre-handoff' : 'strict final';
  console.log('');
  console.log(`PlugForge final submission gate passed (${mode}).`);
}

function printBanner() {
  console.error('');
  console.error('══════════════════════════════════════════════════════════════════');
  console.error('  PLUGFORGE FINAL SUBMISSION — single gate, runs everything');
  console.error('══════════════════════════════════════════════════════════════════');
  console.error('');
  console.error('Steps: proof pack → OAuth E2E → gate honesty → evidence/URLs → ledger enforce');
  if (allowManualPending) console.error('Mode: pre-handoff (--allow-manual-pending for grader OAuth only)');
  else console.error('Mode: strict final handoff');
  if (skipProofPack) console.error('Skip: proof pack (--skip-proof-pack)');
  if (skipOauthE2e) console.error('Skip: OAuth E2E (--skip-oauth-e2e)');
  console.error('');
}

function runStep(label, command, commandArgs) {
  console.error('');
  console.error('──────────────────────────────────────────────────────────────────');
  console.error(`  ${label}`);
  console.error('──────────────────────────────────────────────────────────────────');
  run(command, commandArgs);
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: rootDir, stdio: 'inherit' });
}

function runLegacySubmissionChecks(options = {}) {
  const errors = [];
  if (options.render) {
    const render = runQuiet('pnpm', ['submission:render']);
    if (render.status !== 0) errors.push(summarizeChildFailure('pnpm submission:render', render));
  }
  const check = runQuiet('pnpm', ['submission:check']);
  if (check.status !== 0) errors.push(summarizeChildFailure('pnpm submission:check', check));
  return errors;
}

function runQuiet(command, commandArgs) {
  try {
    execFileSync(command, commandArgs, { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' });
    return { status: 0, output: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      output: [error.stdout, error.stderr].filter(Boolean).join('\n'),
    };
  }
}

function summarizeChildFailure(label, result) {
  const lines = String(result.output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const usefulLine = lines.find((line) => line.includes('Submission ledger validation failed')) ?? lines[0] ?? 'no output';
  return `${label} exited ${result.status}: ${usefulLine}`;
}

function validateRequiredFiles(files) {
  return files
    .filter((file) => !existsSync(path.join(rootDir, file)))
    .map((file) => `${file} is missing`);
}

function validateOutOfScopeSubmissionAtoms(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const errors = [];
  for (const id of outOfScopeSubmissionAtoms) {
    const entry = byId.get(id);
    if (!entry) {
      errors.push(`${id} is missing from proof ledger (must remain non_scope — excluded from submission gate)`);
      continue;
    }
    if (entry.status !== 'non_scope') {
      errors.push(
        `${id} must stay non_scope; demo video, presearch attachment, and social post do not block submission`
      );
    }
  }
  return errors;
}

function validateLedgerTargets(entries, options = {}) {
  const errors = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const skipped = new Set(outOfScopeSubmissionAtoms);
  const requireProven = (options.allowManualPending ? baseClosedAtoms : [...baseClosedAtoms, ...externalAttachmentAtoms])
    .filter((id) => !skipped.has(id));

  for (const id of requireProven) {
    const entry = byId.get(id);
    if (!entry) {
      errors.push(`${id} is missing from proof ledger`);
      continue;
    }
    if (entry.status !== 'proven') {
      errors.push(`${id} must be proven before ${options.allowManualPending ? 'pre-handoff' : 'strict'} submission gate; found ${entry.status}`);
      continue;
    }
    errors.push(...validateManualEvidence(entry));
  }

  if (options.allowManualPending) {
    for (const id of externalAttachmentAtoms) {
      const entry = byId.get(id);
      if (!entry) {
        errors.push(`${id} is missing from proof ledger`);
        continue;
      }
      if (!['manual_pending', 'proven'].includes(entry.status)) {
        errors.push(`${id} must remain manual_pending or proven before external handoff; found ${entry.status}`);
      }
      if (entry.status === 'proven') errors.push(...validateManualEvidence(entry));
    }
  }

  const global = byId.get('W6-GLOBAL-001');
  if (!global) errors.push('W6-GLOBAL-001 is missing from proof ledger');
  if (global?.status === 'proven' && options.allowManualPending) {
    errors.push('W6-GLOBAL-001 must not be proven while --allow-manual-pending is used');
  }

  return errors;
}

function validateManualEvidence(entry) {
  if (isNone(entry.manual_evidence)) return [`${entry.id} must name manual_evidence`];
  const errors = [];
  for (const item of splitList(entry.manual_evidence)) {
    if (isUrl(item)) continue;
    if (!existsSync(path.join(rootDir, item))) {
      errors.push(`${entry.id} manual_evidence path or URL is not valid: ${item}`);
    }
  }
  return errors;
}

function validateEvidenceJson() {
  const errors = [];
  for (const file of [
    'my-docs/evidence/plugforge-metrics/summary.json',
  ]) {
    try {
      const json = JSON.parse(readFileSync(path.join(rootDir, file), 'utf8'));
      if (json.ok === false || json.status === 'failed') errors.push(`${file} reports a failed status`);
      if (!json.generatedAt && !json.generated_at) errors.push(`${file} does not include generatedAt/generated_at`);
    } catch (error) {
      errors.push(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

async function validateUrls(urls) {
  const errors = [];
  for (const target of urls) {
    try {
      const response = await fetch(target.url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        errors.push(`${target.label} ${target.url} returned HTTP ${response.status}`);
        continue;
      }
      if (target.kind === 'health') {
        const json = await response.json();
        if (json.status !== 'ok') errors.push(`${target.label} did not return status ok`);
        if (json.plugforge !== true) errors.push(`${target.label} did not return plugforge true`);
      } else if (target.kind === 'openapi') {
        const json = await response.json();
        if (!String(json.openapi || '').startsWith('3.')) errors.push(`${target.label} did not return OpenAPI 3.x JSON`);
        if (!json.paths?.['/me'] && !json.paths?.['/api/v1/me']) errors.push(`${target.label} is missing /me`);
      } else {
        const text = await response.text();
        if (text.trim().length === 0) errors.push(`${target.label} returned an empty body`);
      }
    } catch (error) {
      errors.push(`${target.label} ${target.url} is not reachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function isNone(value) {
  return !value || value.trim().toLowerCase() === 'none';
}

function isUrl(value) {
  return /^https?:\/\//.test(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  baseClosedAtoms,
  externalAttachmentAtoms,
  outOfScopeSubmissionAtoms,
  parseLedger,
  validateLedgerTargets,
  validateManualEvidence,
  validateOutOfScopeSubmissionAtoms,
};
