import { writeFileSync } from 'node:fs';
import { parseArgs } from '../../core/cli.mjs';
import {
  DEFAULT_STORE_PATH,
  GENERATED_LEDGER_PATH,
  loadSecurityFindings,
  saveSecurityFindings,
  setFindingStatus,
  linkProbe,
  appendVerification,
  getFindingById,
  lastVerification,
} from '../../core/security-findings-store.mjs';
import { renderSecurityFindingsLedger } from '../../core/security-findings-render.mjs';
import { runSecurityFindingsCheck } from '../../core/security-findings-check.mjs';

function usage() {
  console.log(`shipshape-security findings — SS-FIND workflow (authoritative: security-findings.json)

  list
  show <SS-FIND-NNN>
  status <SS-FIND-NNN> <open|fixed|deferred|accepted_risk|in-progress> [--note "..."]
  render
  check
  link-probe <SS-FIND-NNN> --probe-id <id> --finding-id <id> [--role regression|control]
  record-manual <SS-FIND-NNN> --result pass|fail|confirmed [--note "..."]
  migrate   one-time import from legacy ledger`);
}

function cmdRender() {
  const store = loadSecurityFindings();
  const saved = saveSecurityFindings(store);
  writeFileSync(GENERATED_LEDGER_PATH, renderSecurityFindingsLedger(saved));
  console.log(`Rendered ${GENERATED_LEDGER_PATH}`);
}

function cmdCheck() {
  const result = runSecurityFindingsCheck();
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    process.exit(1);
  }
  console.log('findings check passed');
}

function cmdList() {
  const store = loadSecurityFindings();
  for (const finding of [...store.findings].sort((a, b) => a.id.localeCompare(b.id))) {
    const last = lastVerification(finding);
    const lastStr = last ? `${last.result} @ ${last.at.slice(0, 10)}` : '—';
    console.log(`${finding.id}  ${finding.status.padEnd(14)}  ${finding.severity.padEnd(8)}  ${lastStr}  ${finding.title}`);
  }
}

function cmdShow(id) {
  const store = loadSecurityFindings();
  const finding = getFindingById(store, id);
  if (!finding) {
    console.error(`Finding not found: ${id}`);
    process.exit(1);
  }
  console.log(JSON.stringify(finding, null, 2));
}

function cmdSetStatus(args) {
  const [id, status, ...flagArgs] = args;
  if (!id || !status) {
    usage();
    process.exit(1);
  }
  const flags = parseArgs(flagArgs);
  const store = loadSecurityFindings();
  setFindingStatus(store, id, status, flags.note || null);
  saveSecurityFindings(store);
  cmdRender();
  console.log(`${id} status → ${status}`);
}

function cmdLinkProbe(args) {
  const [findingId, ...flagArgs] = args;
  const flags = parseArgs(flagArgs);
  if (!findingId || !flags.probeId || !flags.findingId) {
    usage();
    process.exit(1);
  }
  const store = loadSecurityFindings();
  linkProbe(store, findingId, {
    probeId: flags.probeId,
    findingId: flags.findingId,
    role: flags.role || 'regression',
    title: flags.title || undefined,
    expectedDenial: flags.expectedDenial || null,
  });
  saveSecurityFindings(store);
  console.log(`Linked ${flags.probeId} → ${findingId}`);
}

function cmdRecordManual(args) {
  const [findingId, ...flagArgs] = args;
  const flags = parseArgs(flagArgs);
  if (!findingId || !flags.result) {
    usage();
    process.exit(1);
  }
  const store = loadSecurityFindings();
  const finding = getFindingById(store, findingId);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  appendVerification(finding, {
    method: 'manual',
    result: flags.result,
    note: flags.note || null,
    stillActive: ['fail', 'confirmed', 'open'].includes(flags.result),
  });
  saveSecurityFindings(store);
  cmdRender();
  console.log(`Recorded manual verification on ${findingId}`);
}

export async function runFindingsCommand(subcommand, rest) {
  switch (subcommand) {
    case 'list':
      cmdList();
      break;
    case 'show':
      cmdShow(rest[0]);
      break;
    case 'render':
      cmdRender();
      break;
    case 'check':
      cmdCheck();
      break;
    case 'status':
    case 'set-status':
      cmdSetStatus(rest);
      break;
    case 'link-probe':
      cmdLinkProbe(rest);
      break;
    case 'record-manual':
      cmdRecordManual(rest);
      break;
    case 'migrate':
      await import('../../findings/migrate-from-ledger.mjs');
      break;
    default:
      usage();
      process.exit(subcommand ? 1 : 0);
  }
}
