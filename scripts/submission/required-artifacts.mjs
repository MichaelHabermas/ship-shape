/** Canonical artifact lists for submission bundle and reviewer checks. */

import { week4 } from './week4-paths.mjs';

export const reviewerBundleRequiredFiles = [
  'index.html',
  'manifest.json',
  week4.dashboard,
  'my-docs/evidence/submission-ledger.json',
  'my-docs/evidence/security-audit/latest.json',
  'my-docs/evidence/security-audit/security-findings.json',
  'my-docs/evidence/security-audit/security-findings-ledger.md',
  week4.securityBrief,
];

export const evidenceBundleRequiredFiles = [
  week4.dashboard,
  'my-docs/evidence/submission-ledger.json',
  'my-docs/evidence/security-audit/latest.json',
  'my-docs/evidence/security-audit/latest.md',
  'my-docs/evidence/security-audit/cat8-audit-deliverable.json',
  'my-docs/evidence/security-audit/security-findings.json',
  'my-docs/evidence/security-audit/security-findings-ledger.md',
  week4.securityBrief,
  week4.gfaBrief,
  week4.improvementReport,
  week4.submissionChecklist,
  week4.cat8Plan,
];
