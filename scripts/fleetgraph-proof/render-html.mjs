// Renders FleetGraph reviewer proof packets as a static high-signal dashboard.
import { escapeHtml } from '../submission/ledger-utils.mjs';

const STATUS_LABEL = {
  pass: 'Pass',
  risk: 'Needs review',
  blocked: 'Blocked',
  fail: 'Fail',
  executed: 'Executed',
  defined: 'Defined',
  skipped: 'Skipped',
  mismatch: 'Mismatch',
  ran: 'Ran',
  missing: 'Missing',
  'not applicable': '-',
};

export function renderHtml(packet, options = {}) {
  const artifactBase = options.artifactBase ?? '../../../';
  const data = JSON.stringify(packet).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FleetGraph Reviewer Proof</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101010; color: #f3f4f6; }
    body { margin: 0; background: #101010; }
    main { max-width: 1180px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
    h2 { margin: 26px 0 10px; font-size: 16px; }
    a { color: #8ec5ff; text-decoration: none; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #2c2c2c; background: #151515; }
    th, td { border-bottom: 1px solid #292929; padding: 8px 9px; text-align: left; vertical-align: top; font-size: 13px; }
    th { color: #cbd5e1; background: #1d1d1d; font-weight: 650; }
    tr:last-child td { border-bottom: 0; }
    .verdict { display: grid; grid-template-columns: minmax(170px, 1fr) repeat(5, auto); gap: 10px; align-items: center; border: 1px solid #2f2f2f; background: #171717; padding: 12px; border-radius: 8px; }
    .meta { color: #a1a1aa; font-size: 12px; white-space: nowrap; }
    .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #3a3a3a; border-radius: 999px; padding: 3px 8px; font-size: 12px; line-height: 1.3; white-space: nowrap; }
    .pass { color: #86efac; border-color: #166534; background: #062b16; }
    .risk, .blocked { color: #fde68a; border-color: #854d0e; background: #2f2105; }
    .fail, .missing { color: #fca5a5; border-color: #7f1d1d; background: #2f0909; }
    .ran { color: #93c5fd; border-color: #1d4ed8; background: #081d3a; }
    .muted { color: #a1a1aa; }
    .timeline { display: grid; grid-template-columns: repeat(6, 1fr); border: 1px solid #2c2c2c; background: #151515; }
    .step { min-width: 0; border-right: 1px solid #292929; padding: 10px; }
    .step:last-child { border-right: 0; }
    .step strong { display: block; margin-bottom: 8px; font-size: 13px; }
    .grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 14px; }
    .panel { border: 1px solid #2c2c2c; background: #151515; border-radius: 8px; padding: 12px; }
    .small { font-size: 12px; }
    .artifact-list { columns: 2; }
    .artifact-list li { break-inside: avoid; margin: 0 0 8px; }
    @media (max-width: 820px) {
      main { padding: 14px; }
      .verdict { grid-template-columns: 1fr; align-items: start; }
      .timeline { grid-template-columns: 1fr; }
      .step { border-right: 0; border-bottom: 1px solid #292929; }
      .grid { grid-template-columns: 1fr; }
      .artifact-list { columns: 1; }
    }
  </style>
</head>
<body>
<main>
  <section class="verdict" aria-label="Verdict">
    <div>
      <h1>FleetGraph Reviewer Proof</h1>
      <div class="meta">${escapeHtml(packet.generatedAt)} · ${escapeHtml(packet.runId)}</div>
    </div>
    ${chip(packet.verdict)}
    <span class="meta">${escapeHtml(packet.git.branch)} @ ${escapeHtml(packet.git.sha.slice(0, 12))}</span>
    <span class="meta">${escapeHtml(packet.target)}</span>
    <span class="meta">surface ${packet.summary.currentSurfacePass ?? '-'} pass / ${packet.summary.currentSurfaceFail ?? '-'} fail</span>
    <span class="meta">scenarios ${packet.summary.provenScenarioCount}/${packet.summary.requiredScenarioCount}</span>
    <span class="meta">signals ${(packet.summary.deployedSignals ?? []).join(', ') || '-'}</span>
  </section>

  <h2>Attention Loop Timeline</h2>
  <section class="timeline">
    ${packet.loopTimeline.map((step) => `<div class="step"><strong>${escapeHtml(step.name)}</strong>${chip(step.status)}<div class="meta">${artifactLink(step.evidence, step.evidence, artifactBase)}</div></div>`).join('')}
  </section>

  <h2>Graph Path Matrix</h2>
  <table>
    <thead><tr><th>Scenario</th><th>Proactive</th><th>On-demand</th><th>Update</th><th>Quiet</th><th>Human gate</th></tr></thead>
    <tbody>
      ${packet.graphPathMatrix.map((row) => `<tr><td>${escapeHtml(row.title)}<div class="meta">${escapeHtml(row.scenarioId)}</div></td><td>${chip(row.cells.proactive)}</td><td>${chip(row.cells.onDemand)}</td><td>${chip(row.cells.update)}</td><td>${chip(row.cells.quiet)}</td><td>${chip(row.cells.humanGate)}</td></tr>`).join('')}
    </tbody>
  </table>

  <h2>Current Findings</h2>
  <table>
    <thead><tr><th>Signal</th><th>Source</th><th>Visible copy</th><th>Next action</th><th>Status</th></tr></thead>
    <tbody>
      ${packet.currentFindings.map((finding) => `<tr><td>${escapeHtml(finding.signal)}</td><td>${escapeHtml(finding.source)}</td><td>${escapeHtml(finding.visibleCopy)}</td><td>${escapeHtml(finding.nextAction)}</td><td>${chip(finding.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No current product-surface samples were available.</td></tr>'}
    </tbody>
  </table>

  <h2>Deployed Evidence</h2>
  <div class="panel small">
    ${packet.deployedEvidence
      ? `<p>Worker ticks: ${packet.deployedEvidence.workerTickCount}</p><p>Completed output ticks: ${packet.deployedEvidence.completedWorkerTickCount}</p><p>Stuck running ticks: ${packet.deployedEvidence.stuckRunningTickCount}</p><p>Signals: ${(packet.deployedEvidence.signalTypes ?? []).map(escapeHtml).join(', ') || '-'}</p><p>Scheduled-worker signals: ${(packet.deployedEvidence.scheduledWorkerSignalTypes ?? []).map(escapeHtml).join(', ') || '-'}</p>`
      : '<p>No deployed database evidence was configured.</p>'}
  </div>

  <div class="grid">
    <section>
      <h2>Safety And Privacy</h2>
      <table>
        <thead><tr><th>Check</th><th>Status</th><th>Evidence</th></tr></thead>
        <tbody>${packet.safety.map((check) => `<tr><td>${escapeHtml(check.name)}</td><td>${chip(check.status)}</td><td>${escapeHtml(check.evidence)}</td></tr>`).join('')}</tbody>
      </table>
    </section>
    <section>
      <h2>Cost And Ops</h2>
      <div class="panel small">
        <p>Runs: ${packet.costs.runCount}</p>
        <p>Command time: ${packet.costs.measuredCommandMs} ms</p>
        <p>Model cost: ${escapeHtml(packet.costs.modelCost)}</p>
        <p>p95 latency: ${escapeHtml(packet.costs.p95Latency)}</p>
        <p>100 projects: ${escapeHtml(packet.costs.projected100Projects)}</p>
        <p>1,000 projects: ${escapeHtml(packet.costs.projected1000Projects)}</p>
      </div>
    </section>
  </div>

  <h2>Risks And Non-Claims</h2>
  <div class="grid">
    <div class="panel">${list(packet.risks.length ? packet.risks : ['None recorded.'])}</div>
    <div class="panel">${list(packet.nonClaims)}</div>
  </div>

  <h2>Artifacts</h2>
  <div class="panel"><ul class="artifact-list">${packet.artifacts.map((artifact) => `<li>${artifactLink(artifact.path, artifact.label, artifactBase)} <span class="meta">${escapeHtml(artifact.kind)}</span></li>`).join('')}</ul></div>
</main>
<script type="application/json" id="proof-data">${data}</script>
</body>
</html>`;
}

function chip(status) {
  return `<span class="chip ${escapeHtml(String(status))}">${escapeHtml(STATUS_LABEL[status] ?? status)}</span>`;
}

function artifactLink(path, label = path, base = '../../../') {
  if (!path) return '';
  const href = path.startsWith('http') ? path : `${base}${path}`;
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}
