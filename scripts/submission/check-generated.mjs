#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dashboardPath, readJson, readLedger, repoRelative } from './ledger-utils.mjs';
import {
  discoveriesPath,
  renderDashboard,
  securityDeliverablePath,
  securityFindingsPath,
  securityReportPath,
} from './render-dashboard.mjs';

const validateLedgerScript = fileURLToPath(new URL('./validate-ledger.mjs', import.meta.url));
const renderMarkdownScript = fileURLToPath(new URL('./render-markdown-sections.mjs', import.meta.url));

function normalizeWrittenText(text) {
  const cleanText = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  return cleanText.endsWith('\n') ? cleanText : `${cleanText}\n`;
}

execFileSync(process.execPath, [validateLedgerScript], { stdio: 'inherit' });
const ledger = await readLedger();
const discoveries = await readJson(discoveriesPath);
const securityReport = await readJson(securityReportPath);
const securityFindings = await readJson(securityFindingsPath);
const securityDeliverable = await readJson(securityDeliverablePath);
const expectedDashboard = normalizeWrittenText(
  renderDashboard(ledger, discoveries, securityReport, securityFindings, securityDeliverable)
);
const actualDashboard = await readFile(dashboardPath, 'utf8');

if (actualDashboard !== expectedDashboard) {
  console.error(`${repoRelative(dashboardPath)} is stale. Run pnpm submission:render-dashboard.`);
  process.exit(1);
}

execFileSync(process.execPath, [renderMarkdownScript, '--check'], { stdio: 'inherit' });
console.log('Generated submission artifacts are current.');
