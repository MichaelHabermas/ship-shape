import { buildSecurityView } from './build-view.mjs';
import { renderDeliverableTable } from './deliverable-table.mjs';
import { renderFindingsExplorerShell } from './findings-explorer.mjs';
import { renderSecurityEvidenceMap } from './evidence-map.mjs';
import { renderManualReview, renderSurfaceCards, renderTriageChips } from './manual-review.mjs';
import { renderLatestFindings, renderProbeTableShell } from './probe-explorer.mjs';
import { buildSecurityPayload, renderSecurityPayloadScript } from './payload.mjs';
import { securityDashboardStyles } from './styles.mjs';
import { renderVerifiedFixes } from './verified-fixes.mjs';
import { securityStatusClass } from './utils.mjs';
import { renderSecurityClientScript } from './client.mjs';

export { buildSecurityView, buildSecurityPayload, renderSecurityPayloadScript, securityDashboardStyles };

function securityMetricCards(view, escapeHtml) {
  const summary = view.report?.summary || {};
  const runId = view.report?.run?.id || view.report?.run?.runId || 'unknown run';
  const generatedAt = view.report?.generatedAt || view.findingsStore?.updatedAt || 'unknown time';
  const cards = [
    ['Latest run', runId, generatedAt],
    [
      'Surfaces measured',
      `${summary.attackSurfacesMeasured ?? 0}/${summary.attackSurfacesTotal ?? 0}`,
      '4 required for Cat 8; default run includes authorization (v2)',
    ],
    ['Named probes passed', String(summary.probesByStatus?.passed ?? '—'), 'From latest.json'],
    ['Latest confirmed findings', String(summary.findings ?? 0), 'Latest active probe only'],
    ['Resolved triage', String(view.triageCounts.resolved ?? 0), 'Passed after registry expected failure'],
    ['Active backlog', String(view.activeFindings.length), 'SS-FIND workflow store'],
  ];
  return `<div class="security-metric-grid">${cards
    .map(
      ([label, value, note]) => `
        <div class="mini security-mini">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </div>`
    )
    .join('')}</div>`;
}

function renderActionBar(view, helpers) {
  const { escapeHtml, badge, code } = helpers;
  const summary = view.report?.summary || {};
  return `
    <div class="security-action-bar" id="security-action-bar">
      <div class="security-status-chips">
        ${view.category ? badge(view.category.status) : ''}
        <span class="test-chip pass">run: ${escapeHtml(view.report?.run?.id || 'none')}</span>
        ${renderTriageChips(view, helpers)}
      </div>
      <div class="security-action-group">
        <label class="security-filter-label" style="min-width:auto">
          <span>Perimeter</span>
          <input type="checkbox" id="security-cat8-perimeter" title="4-surface Cat 8 perimeter mode" />
        </label>
        <button type="button" class="security-action-btn primary" id="security-run-probe" disabled>Run probe</button>
        <button type="button" class="security-action-btn" id="security-run-check" disabled>Findings check</button>
        <button type="button" class="security-action-btn security-action-btn-danger" id="security-run-ci" disabled>Run CI gate</button>
        <button type="button" class="security-action-btn" id="security-refresh-page">Refresh page</button>
        <label class="security-filter-label" style="min-width:auto">
          <span>Auto-refresh</span>
          <input type="checkbox" id="security-auto-refresh" checked title="After successful run, reload dashboard data" />
        </label>
      </div>
      <p class="security-console-hint" id="security-console-hint">
        Interactive runs require ${code('pnpm security:console')} (local server). Grader path: ${code('pnpm security:probe:ci')}.
      </p>
      <p id="security-console-toast" class="security-console-toast" hidden aria-live="polite"></p>
    </div>
    <div class="security-run-log" id="security-run-log" hidden>
      <div class="security-run-log-header">
        <strong id="security-run-log-title">Probe log</strong>
        <button type="button" class="security-action-btn" id="security-copy-log">Copy log</button>
      </div>
      <pre id="security-run-log-body"></pre>
    </div>
    <div id="security-ci-modal" class="security-modal" hidden role="dialog" aria-modal="true" aria-labelledby="security-ci-modal-title">
      <div class="security-modal-inner">
        <h3 id="security-ci-modal-title">Run CI gate locally?</h3>
        <p>This mirrors <code>pnpm security:probe:ci</code>: migrates/seeds <code>ship_test_audit</code>, starts API on port <strong>3099</strong>, runs package tests + full probe with <code>--fail-on=new</code>. May take several minutes and can conflict with <code>pnpm dev</code>.</p>
        <div class="security-modal-actions">
          <button type="button" class="security-action-btn" id="security-ci-cancel">Cancel</button>
          <button type="button" class="security-action-btn primary security-action-btn-danger" id="security-ci-confirm">Run CI gate</button>
        </div>
      </div>
    </div>`;
}

export function buildSecurityTabHtml(ledger, securityReport, securityFindings, deliverable, helpers) {
  const { escapeHtml, badge, code, linkedPath, repoLink } = helpers;
  const view = buildSecurityView(ledger, securityReport, securityFindings, deliverable);
  const helpersWithStatus = { ...helpers, securityStatusClass };
  const source = view.category?.source_requirement;
  const nonClaims = [...(view.category?.non_claims || []), ...(view.category?.caveats || [])];
  const payload = buildSecurityPayload(ledger, securityReport, securityFindings, deliverable);

  return `
      <section id="panel-security" class="tab-panel" role="tabpanel" aria-labelledby="tab-security" tabindex="0" hidden>
        ${renderSecurityPayloadScript(payload)}
        <article class="panel security-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Category 8 · Security Console</p>
              <h2>Security Evidence &amp; Probe Control</h2>
              <p>${escapeHtml(source?.statement || 'Security evidence is generated from the Category 8 source requirements and security findings store.')} ${
                source?.source ? helpers.repoLink(source.source, 'Source brief') : ''
              }</p>
            </div>
            ${view.category ? helpers.badge(view.category.status) : ''}
          </div>
          <div class="callout security-callout">
            <strong>Two signals:</strong> latest probe (${escapeHtml(String(view.report?.summary?.findings ?? 0))} confirmed in last run) vs SS-FIND backlog (${escapeHtml(String(view.findings.length))} tracked rows, ${escapeHtml(String(view.activeFindings.length))} active). A clean probe does not close the deep-review backlog.
          </div>
          ${renderActionBar(view, helpersWithStatus)}
          ${securityMetricCards(view, helpers.escapeHtml)}

          <h3 id="security-deliverable">Audit deliverable (brief table)</h3>
          ${renderDeliverableTable(view, helpersWithStatus)}

          <h3 id="security-surfaces">Attack surfaces &amp; manual review</h3>
          ${renderSurfaceCards(view, helpersWithStatus)}
          ${renderManualReview(view, helpersWithStatus)}

          <h3 id="security-verified-fixes">Verified vulnerability fixes (×2)</h3>
          ${renderVerifiedFixes(view, helpersWithStatus)}

          <h3 id="security-latest-findings">Latest probe findings</h3>
          ${renderLatestFindings(view, helpersWithStatus)}

          <h3 id="security-findings">SS-FIND backlog</h3>
          <p class="subtle">Authoritative workflow store: security-findings.json. Click a row for narrative, probes, and status (console server).</p>
          ${renderFindingsExplorerShell(view, helpersWithStatus)}

          <h3 id="security-probes">Probe explorer</h3>
          ${renderProbeTableShell(view, helpersWithStatus)}

          <h3 id="security-evidence">Evidence bundle map</h3>
          ${renderSecurityEvidenceMap(view, helpersWithStatus)}

          <h3 id="security-commands">Rerun / validate (CLI)</h3>
          <ul class="check-list security-cli-list">
            <li><strong>Interactive console</strong><span><code data-copy-command="pnpm security:console">pnpm security:console</code> <button type="button" class="security-copy-btn" data-copy-command="pnpm security:console">Copy</button></span></li>
            <li><strong>Local reviewer run</strong><span><code data-copy-command="pnpm dev">pnpm dev</code> then <code data-copy-command="pnpm security:probe">pnpm security:probe</code> <button type="button" class="security-copy-btn" data-copy-command="pnpm security:probe">Copy probe</button></span></li>
            <li><strong>CI-shaped gate</strong><span><code data-copy-command="pnpm security:probe:ci">pnpm security:probe:ci</code> <button type="button" class="security-copy-btn" data-copy-command="pnpm security:probe:ci">Copy</button></span></li>
            <li><strong>Regenerate dashboard</strong><span><code data-copy-command="pnpm submission:render-dashboard">pnpm submission:render-dashboard</code> <button type="button" class="security-copy-btn" data-copy-command="pnpm submission:render-dashboard">Copy</button></span></li>
          </ul>

          <h3>Explicit non-claims</h3>
          <ul class="check-list">${nonClaims.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join('')}</ul>
        </article>
      </section>`;
}

export function renderSecurityClientBundle() {
  return renderSecurityClientScript();
}
