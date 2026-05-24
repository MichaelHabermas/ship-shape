import { buildSecurityView } from './build-view.mjs';
import { renderDeliverableTable } from './deliverable-table.mjs';
import { renderFindingsTable } from './findings-explorer.mjs';
import { renderSecurityEvidenceMap } from './evidence-map.mjs';
import { renderManualReview, renderSurfaceCards } from './manual-review.mjs';
import { renderLatestFindings, renderProbeTableShell } from './probe-explorer.mjs';
import { securityDashboardStyles } from './styles.mjs';
import { renderVerifiedFixes } from './verified-fixes.mjs';
import { securityStatusClass } from './utils.mjs';
import { renderSecurityClientScript } from './client.mjs';

export { buildSecurityView, securityDashboardStyles };

function securityMetricCards(view, escapeHtml) {
  const summary = view.report?.summary || {};
  const runId = view.report?.run?.id || view.report?.run?.runId || '—';
  const cards = [
    ['Latest run', runId],
    ['Surfaces', `${summary.attackSurfacesMeasured ?? 0}/${summary.attackSurfacesTotal ?? 0}`],
    ['Probes passed', String(summary.probesByStatus?.passed ?? '—')],
    ['Confirmed (last run)', String(summary.findings ?? 0)],
    ['SS-FIND active', String(view.activeFindings.length)],
    ['Triage resolved', String(view.triageCounts.resolved ?? 0)],
  ];
  return `<div class="security-metric-grid">${cards
    .map(
      ([label, value]) => `
        <div class="mini security-mini">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>`
    )
    .join('')}</div>`;
}

function renderReproduceBar(helpers) {
  const { code } = helpers;
  return `
    <div class="security-reproduce">
      <p><strong>Reproduce (clone repo, then):</strong> ${code('pnpm security:probe:ci')}</p>
      <button type="button" class="security-copy-btn" data-copy-command="pnpm security:probe:ci">Copy</button>
      <p id="security-copy-toast" class="security-copy-toast" hidden aria-live="polite">Copied</p>
    </div>`;
}

export function buildSecurityTabHtml(ledger, securityReport, securityFindings, deliverable, helpers) {
  const { escapeHtml, badge, linkedPath, repoLink } = helpers;
  const view = buildSecurityView(ledger, securityReport, securityFindings, deliverable);
  const helpersWithStatus = { ...helpers, securityStatusClass };
  const source = view.category?.source_requirement;
  const nonClaims = [...(view.category?.non_claims || []), ...(view.category?.caveats || [])];

  return `
      <section id="panel-security" class="tab-panel" role="tabpanel" aria-labelledby="tab-security" tabindex="0" hidden>
        <article class="panel security-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Category 8 · Security audit</p>
              <h2>Security evidence</h2>
              <p class="security-lede">${escapeHtml(source?.statement || 'Runnable probe evidence and SS-FIND workflow store.')} ${
                source?.source ? repoLink(source.source, 'Source brief') : ''
              }</p>
            </div>
            ${view.category ? badge(view.category.status) : ''}
          </div>
          ${renderReproduceBar(helpers)}
          <p class="security-signals">Latest probe: <strong>${escapeHtml(String(view.report?.summary?.findings ?? 0))}</strong> confirmed finding(s). SS-FIND backlog: <strong>${escapeHtml(String(view.activeFindings.length))}</strong> active of <strong>${escapeHtml(String(view.findings.length))}</strong> tracked. A clean probe does not close the backlog.</p>
          ${securityMetricCards(view, escapeHtml)}

          <h3 id="security-deliverable">Deliverable table</h3>
          ${renderDeliverableTable(view, helpersWithStatus)}

          <h3 id="security-surfaces">Attack surfaces &amp; manual review</h3>
          ${renderSurfaceCards(view, helpersWithStatus)}
          ${renderManualReview(view, helpersWithStatus)}

          <h3 id="security-verified-fixes">Verified fixes (×2)</h3>
          ${renderVerifiedFixes(view, helpersWithStatus)}

          <h3 id="security-latest-findings">Latest probe findings</h3>
          ${renderLatestFindings(view, helpersWithStatus)}

          <h3 id="security-findings">SS-FIND backlog</h3>
          <p class="subtle">Workflow store: ${linkedPath('my-docs/evidence/security-audit/security-findings.json', 'security-findings.json')}</p>
          <div class="table-wrap">
            <table class="security-findings-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Active</th>
                  <th>OWASP / Category</th>
                  <th>Primary location</th>
                  <th>Narrative</th>
                  <th>Last verification</th>
                </tr>
              </thead>
              <tbody>${renderFindingsTable(view, helpersWithStatus)}</tbody>
            </table>
          </div>

          <h3 id="security-probes">Probe results (latest run)</h3>
          ${renderProbeTableShell(view, helpersWithStatus)}

          <h3 id="security-evidence">Evidence files</h3>
          ${renderSecurityEvidenceMap(view, helpersWithStatus)}

          <h3>Non-claims</h3>
          <ul class="check-list">${nonClaims.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join('')}</ul>
        </article>
      </section>`;
}

export function renderSecurityClientBundle() {
  return renderSecurityClientScript();
}
