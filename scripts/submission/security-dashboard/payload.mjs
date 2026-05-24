import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../ledger-utils.mjs';
import { safeNarrativePath } from '../../../packages/shipshape-security/src/console/narrative-paths.mjs';
import { markdownToHtml } from '../../../packages/shipshape-security/src/core/markdown-lite.mjs';
import { buildSecurityView } from './build-view.mjs';

export const securityDeliverablePath = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/cat8-audit-deliverable.json'
);
export const securityNarrativesDir = resolve(
  repoRoot,
  'my-docs/evidence/security-audit/security-findings/narratives'
);

function loadNarratives(findings) {
  const narratives = {};
  for (const finding of findings) {
    if (!finding.narrativePath) continue;
    const fullPath = safeNarrativePath(finding.narrativePath);
    if (!fullPath) continue;
    const md = readFileSync(fullPath, 'utf8');
    narratives[finding.id] = {
      path: finding.narrativePath,
      markdown: md,
      html: markdownToHtml(md),
    };
  }
  return narratives;
}

export function buildSecurityPayload(ledger, securityReport, securityFindings, deliverable) {
  const view = buildSecurityView(ledger, securityReport, securityFindings, deliverable);
  const narratives = loadNarratives(view.findings);
  const category = view.category;
  return {
    version: 1,
    generatedAt: securityReport?.generatedAt || securityFindings?.updatedAt || null,
    consoleApiBase: '',
    run: {
      id: view.report?.run?.id || null,
      generatedAt: view.report?.generatedAt || null,
      summary: view.report?.summary || null,
      triageCounts: view.triageCounts,
    },
    deliverable: {
      explanation: deliverable?.explanation || null,
      table: deliverable?.table || [],
    },
    manualReview: view.report?.manualReview || null,
    probes: view.probes,
    latestFindings: view.latestFindings,
    findings: view.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      activeLabel: finding.activeLabel,
      owasp: finding.owasp,
      category: finding.category,
      definition: finding.definition,
      primaryLocations: finding.primaryLocations,
      narrativePath: finding.narrativePath,
      probes: finding.probes,
      verifications: finding.verifications,
      lastVerification: finding.lastVerification,
    })),
    narratives,
    ledger: category
      ? {
          id: category.id,
          status: category.status,
          probeTool: category.audit_deliverable?.probe_tool || null,
          nonClaims: [...(category.non_claims || []), ...(category.caveats || [])],
        }
      : null,
    metrics: {
      activeBacklog: view.activeFindings.length,
      latestConfirmedFindings: view.report?.summary?.findings ?? 0,
    },
  };
}

export function renderSecurityPayloadScript(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script type="application/json" id="ship-security-payload">${json}</script>`;
}
