#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from '../security-probe/lib/cli.mjs';
import {
  DEFAULT_STORE_PATH,
  GENERATED_LEDGER_PATH,
  loadSecurityFindings,
  saveSecurityFindings,
  setFindingStatus,
  linkProbe,
  appendVerification,
  fingerprintForFinding,
  registryStatusToProbeRole,
} from '../security-probe/lib/security-findings-store.mjs';
import { renderSecurityFindingsLedger } from '../security-probe/lib/security-findings-render.mjs';
import { runSecurityFindingsCheck } from '../security-probe/lib/security-findings-check.mjs';

const [command, ...rest] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  pnpm security:findings:migrate
  pnpm security:findings:render
  pnpm security:findings:check
  pnpm security:findings:set-status <SS-FIND-NNN> <status> [--note "..."]
  pnpm security:findings:link-probe <SS-FIND-NNN> --probe-id <id> --finding-id <id> [--role regression|control]
  pnpm security:findings:record-manual <SS-FIND-NNN> --result pass|fail|confirmed [--note "..."]`);
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
  console.log('security-findings:check passed');
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
  const finding = store.findings.find((item) => item.id === findingId);
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

switch (command) {
  case 'migrate':
    console.error('Use: pnpm security:findings:migrate');
    process.exit(1);
    break;
  case 'render':
    cmdRender();
    break;
  case 'check':
    cmdCheck();
    break;
  case 'set-status':
    cmdSetStatus(rest);
    break;
  case 'link-probe':
    cmdLinkProbe(rest);
    break;
  case 'record-manual':
    cmdRecordManual(rest);
    break;
  default:
    usage();
    process.exit(command ? 1 : 0);
}
