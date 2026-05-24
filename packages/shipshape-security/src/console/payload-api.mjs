import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { repoRoot } from '../core/paths.mjs';

const securityReportPath = resolve(repoRoot, 'my-docs/evidence/security-audit/latest.json');
const securityFindingsPath = resolve(repoRoot, 'my-docs/evidence/security-audit/security-findings.json');
const securityDeliverablePath = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/cat8-audit-deliverable.json'
);
const ledgerPath = resolve(repoRoot, 'my-docs/evidence/submission-ledger.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let payloadModulePromise;

async function loadPayloadModule() {
  if (!payloadModulePromise) {
    const url = pathToFileURL(resolve(repoRoot, 'scripts/submission/security-dashboard/payload.mjs')).href;
    payloadModulePromise = import(url);
  }
  return payloadModulePromise;
}

export async function loadSecurityConsolePayload() {
  const { buildSecurityPayload } = await loadPayloadModule();
  const ledger = readJson(ledgerPath);
  const securityReport = readJson(securityReportPath);
  const securityFindings = readJson(securityFindingsPath);
  let deliverable = null;
  try {
    deliverable = readJson(securityDeliverablePath);
  } catch {
    deliverable = null;
  }
  return buildSecurityPayload(ledger, securityReport, securityFindings, deliverable);
}
